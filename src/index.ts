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

// Types
interface Player {
  username: string;
  displayName: string;
}

interface EventsResponse {
  gatherFoods: {
    items: Array<{
      id: string;
      timeGatherFood: string;
      foodAdded: number;
      numVillagers: number;
      player: Player;
    }>;
  };
  chopWoods: {
    items: Array<{
      id: string;
      timeChopWood: string;
      woodAdded: number;
      numVillagers: number;
      player: Player;
    }>;
  };
  buildHuts: {
    items: Array<{
      id: string;
      timeBuildHut: string;
      hutsAdded: number;
      player: Player;
    }>;
  };
  commitDefenses: {
    items: Array<{
      id: string;
      timeCommittedDefense: string;
      player: Player;
    }>;
  };
  attackVillages: {
    items: Array<{
      id: string;
      timeAttackedVillage: string;
      resourceToSteal: number;
      attackerPlayer: Player;
      defenderPlayer: Player;
    }>;
  };
  revealBattles: {
    items: Array<{
      id: string;
      timeRevealed: string;
      winnerVillageIds: string;
      resourcesExchanged: string;
      amountResourcesExchanged: string;
      attackerPlayer: Player;
      defenderPlayer: Player;
    }>;
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

// Format time difference
function formatTimeDifference(timestamp: string): string {
  const diff = Date.now() - Number(timestamp) * 1000;
  if (diff < 60000) return 'a few seconds ago';
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }
  const hours = Math.floor(diff / 3600000);
  return `${hours} hour${hours > 1 ? 's' : ''} ago`;
}

// Function to normalize events from different types into a common format
function normalizeEvents(response: EventsResponse): Array<{ id: string, timestamp: string, type: string, data: any }> {
  const events = [];

  if (response.gatherFoods?.items) {
    events.push(...response.gatherFoods.items.map(item => ({
      id: item.id,
      timestamp: item.timeGatherFood,
      type: 'GATHER_FOOD',
      data: item
    })));
  }

  if (response.chopWoods?.items) {
    events.push(...response.chopWoods.items.map(item => ({
      id: item.id,
      timestamp: item.timeChopWood,
      type: 'CHOP_WOOD',
      data: item
    })));
  }

  if (response.buildHuts?.items) {
    events.push(...response.buildHuts.items.map(item => ({
      id: item.id,
      timestamp: item.timeBuildHut,
      type: 'BUILD_HUT',
      data: item
    })));
  }

  if (response.commitDefenses?.items) {
    events.push(...response.commitDefenses.items.map(item => ({
      id: item.id,
      timestamp: item.timeCommittedDefense,
      type: 'COMMIT_DEFENSE',
      data: item
    })));
  }

  if (response.attackVillages?.items) {
    events.push(...response.attackVillages.items.map(item => ({
      id: item.id,
      timestamp: item.timeAttackedVillage,
      type: 'ATTACK_VILLAGE',
      data: item
    })));
  }

  if (response.revealBattles?.items) {
    events.push(...response.revealBattles.items.map(item => ({
      id: item.id,
      timestamp: item.timeRevealed,
      type: 'REVEAL_BATTLE',
      data: item
    })));
  }

  // Sort by timestamp descending (latest first)
  return events.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
}

// Format event message
function formatEventMessage(event: { type: string; data: any; timestamp: string }): string {
  const time = formatTimeDifference(event.timestamp);
  const username = `@${event.data.player?.username || event.data.attackerPlayer?.username}`;

  switch (event.type) {
    case 'GATHER_FOOD':
      return `${username} gathered ${event.data.foodAdded} food with ${event.data.numVillagers} villagers ${time}`;

    case 'BUILD_HUT':
      return `${username} built ${event.data.hutsAdded} hut${event.data.hutsAdded > 1 ? 's' : ''} ${time}`;

    case 'CHOP_WOOD':
      return `${username} gathered ${event.data.woodAdded} wood with ${event.data.numVillagers} villagers ${time}`;

    case 'COMMIT_DEFENSE':
      return `${username} committed their defense ${time}`;

    case 'ATTACK_VILLAGE':
      return `${username} raided @${event.data.defenderPlayer.username}'s village, tried to steal ${event.data.resourceToSteal} resources ${time}`;

    case 'REVEAL_BATTLE': {
      const isAttackerWinner = event.data.winnerVillageIds.includes(event.data.attackerPlayer.username);
      const winner = isAttackerWinner ? event.data.attackerPlayer.username : event.data.defenderPlayer.username;
      return `${username} revealed battle. @${winner} won ${event.data.amountResourcesExchanged} ${event.data.resourcesExchanged} ${time}`;
    }

    default:
      return `${username} performed an action ${time}`;
  }
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
async function processEvents() {
  try {
    const lastTimestamp = await getLastProcessedTimestamp();
    console.log(`Fetching events after timestamp ${lastTimestamp}`);

    const response = await graphqlClient.request<EventsResponse>(EVENTS_QUERY, {
      timestamp: lastTimestamp,
      limit: BATCH_SIZE
    });

    const normalizedEvents = normalizeEvents(response);

    if (normalizedEvents.length > 0) {
      // Process events from oldest to newest
      const eventsToProcess = [...normalizedEvents].reverse();

      for (const event of eventsToProcess) {
        const message = formatEventMessage(event);
        await postToFarcaster(message);
        await updateLastProcessedTimestamp(event.timestamp);
        console.log(`Posted event from ${event.timestamp}`);
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