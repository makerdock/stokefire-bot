import axios from 'axios';
import { config } from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { gql } from 'graphql-tag';
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
const BATCH_SIZE = 50;

// GraphQL client setup
const graphqlClient = new GraphQLClient('https://api.stokefire.xyz/graphql');

// Neynar API setup
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_API_URL = 'https://api.neynar.com/v2/farcaster/cast';

// GraphQL query
const EVENTS_QUERY = gql`
   query GetEvents($timestamp: BigInt!, $limit: Int!) {
    events(
      limit: $limit
      orderBy: "eventTime"
      orderDirection: "desc"
      where: { eventTime_gt: $timestamp,
        OR: [
          { eventType: "RevealBattle" },
          { eventType: "AttackVillage" }
        ] }
    ) {
      items {
        id
        eventTime
        eventType
        description
        player {
          username
          displayName
        }       
      }
      pageInfo {
        hasNextPage
        endCursor
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
// Post to Farcaster using Neynar API
async function postToFarcaster(message: string) {
  try {
    if (!process.env.NEYNAR_SIGNER_UUID) {
      console.error('Please provide a NEYNAR_SIGNER_UUID environment variable');
      return;
    }
    const response = await axios.post(NEYNAR_API_URL,
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

    if (response.status !== 200) {
      console.log("🚀 ~ postToFarcaster ~ data:", JSON.stringify(response.data))
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log('Successfully posted to Farcaster:', message);
    return response.data;
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