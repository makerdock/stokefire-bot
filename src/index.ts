import { GraphQLClient } from 'graphql-request';
import { config } from 'dotenv';
import { gql } from 'graphql-tag';
import axios from 'axios';
import Redis from 'ioredis';

// Load environment variables
config();

if (!process.env.REDIS_URL) {
  console.error('Please provide a REDIS_URL environment variable');
  process.exit(1);
}

// Redis setup
const redis = new Redis(process.env.REDIS_URL);

interface Player {
  username: string;
  displayName: string;
}

interface Event {
  id: string;
  eventTime: string;
  eventType: string;
  description: string;
  player: Player;
}

interface EventsResponse {
  events: {
    items: Event[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string;
    };
  };
}

// Constants
const LAST_PROCESSED_KEY = 'stokefire:last_processed_timestamp';
const BATCH_SIZE = 100;

// GraphQL client setup
const graphqlClient = new GraphQLClient('https://api.stokefire.xyz/graphql');

// Neynar API setup
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_API_URL = 'https://api.neynar.com/v2/farcaster/cast';

// GraphQL query
const EVENTS_QUERY = gql`
  query GetEvents($timestamp: BigInt!, $limit: Int!) {
    gatherFoods(
      limit: $limit
      orderBy: "timeGatherFood"
      orderDirection: "desc"
      where: { timeGatherFood_gt: $timestamp }
    ) {
      items {
        id
        timeGatherFood
        foodAdded
        numVillagers
        player {
          username
          displayName
        }
      }
    }
    chopWoods(
      limit: $limit
      orderBy: "timeChopWood"
      orderDirection: "desc"
      where: { timeChopWood_gt: $timestamp }
    ) {
      items {
        id
        timeChopWood
        woodAdded
        numVillagers
        player {
          username
          displayName
        }
      }
    }
    buildHuts(
      limit: $limit
      orderBy: "timeBuildHut"
      orderDirection: "desc"
      where: { timeBuildHut_gt: $timestamp }
    ) {
      items {
        id
        timeBuildHut
        hutsAdded
        player {
          username
          displayName
        }
      }
    }
    commitDefenses(
      limit: $limit
      orderBy: "timeCommittedDefense"
      orderDirection: "desc"
      where: { timeCommittedDefense_gt: $timestamp }
    ) {
      items {
        id
        timeCommittedDefense
        player {
          username
          displayName
        }
      }
    }
    attackVillages(
      limit: $limit
      orderBy: "timeAttackedVillage"
      orderDirection: "desc"
      where: { timeAttackedVillage_gt: $timestamp }
    ) {
      items {
        id
        timeAttackedVillage
        resourceToSteal
        attackerPlayer {
          username
          displayName
        }
        defenderPlayer {
          username
          displayName
        }
      }
    }
    revealBattles(
      limit: $limit
      orderBy: "timeRevealed"
      orderDirection: "desc"
      where: { timeRevealed_gt: $timestamp }
    ) {
      items {
        id
        timeRevealed
        winnerVillageIds
        resourcesExchanged
        amountResourcesExchanged
        attackerPlayer {
          username
          displayName
        }
        defenderPlayer {
          username
          displayName
        }
      }
    }
  }
`;

// Get last processed timestamp
async function getLastProcessedTimestamp(): Promise<string> {
  const timestamp = await redis.get(LAST_PROCESSED_KEY);
  // If no timestamp exists, start from current time minus 5 minutes
  if (!timestamp) {
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    await redis.set(LAST_PROCESSED_KEY, fiveMinutesAgo.toString());
    return fiveMinutesAgo.toString();
  }
  return timestamp;
}

// Update last processed timestamp
async function updateLastProcessedTimestamp(timestamp: string): Promise<void> {
  await redis.set(LAST_PROCESSED_KEY, timestamp);
}

// Format event message
// Format event message
function formatEventMessage(event: Event): string {
  const username = `@${event.player.username}`;
  return `${username} ${event.description}`;
}

// Post to Farcaster using Neynar API
async function postToFarcaster(message: string) {
  try {
    if (!process.env.NEYNAR_SIGNER_UUID) {
      throw new Error('Please provide a NEYNAR_SIGNER_UUID environment variable');
    }
    const request = await axios.post(NEYNAR_API_URL,
      {
        signer_uuid: process.env.NEYNAR_SIGNER_UUID,
        text: message
      },
      {
        headers: {
          'accept': 'application/json',
          'api_key': NEYNAR_API_KEY,
          'content-type': 'application/json'
        }
      }
    );

    if (request.status !== 200) {
      throw new Error(`Failed to post to Farcaster: ${request.data}`);
    }
    console.log('Successfully posted to Farcaster:', message);
  } catch (error) {
    console.error('Error posting to Farcaster:', error);
  }
}

// Process events
// Process events
async function processEvents() {
  try {
    const lastTimestamp = await getLastProcessedTimestamp();
    console.log(`Fetching events after timestamp ${lastTimestamp}`);

    const response = await graphqlClient.request<EventsResponse>(EVENTS_QUERY, {
      timestamp: lastTimestamp,
      limit: BATCH_SIZE
    });

    if (response.events?.items?.length > 0) {
      // Process events from oldest to newest
      const eventsToProcess = [...response.events.items].reverse();

      for (const event of eventsToProcess) {
        const message = formatEventMessage(event);
        await postToFarcaster(message);
        await updateLastProcessedTimestamp(event.eventTime);
        console.log(`Posted event from ${event.eventTime}`);
      }
    }
  } catch (error) {
    console.error('Error processing events:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }
  }
}

// Cleanup function
async function cleanup() {
  console.log('Cleaning up connections...');
  await redis.quit();
  process.exit(0);
}

// Start polling
async function startPolling() {
  console.log('Connecting to Redis...');

  redis.on('error', (error) => {
    console.error('Redis error:', error);
  });

  redis.on('connect', () => {
    console.log('Connected to Redis successfully');
  });

  // Initial startup
  await processEvents();

  // Poll every 5 seconds
  setInterval(processEvents, 5000);
}

// Error handling
process.on('unhandledRejection', console.error);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start the bot
console.log('Starting Stokefire Farcaster bot...');
startPolling();