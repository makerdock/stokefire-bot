import { GraphQLClient } from 'graphql-request';
import { config } from 'dotenv';
import { gql } from 'graphql-tag';
import axios from 'axios';
import Redis from 'ioredis';

// Load environment variables
config();

if (!process.env.REDIS_URL) {
  console.error('Please provide REDIS_URL in environment variables');
  process.exit(1);
}

// Redis setup
const redis = new Redis(process.env.REDIS_URL);

// Type definitions
interface Player {
  username: string;
  displayName: string;
}

interface BaseEvent {
  id: string;
  eventType: string;
  eventTime: string;
  description: string;
  player: Player;
}

interface GatherFoodEvent extends BaseEvent {
  foodAdded: number;
  numVillagers: number;
}

interface BuildHutEvent extends BaseEvent {
  hutsAdded: number;
}

interface ChopWoodEvent extends BaseEvent {
  woodAdded: number;
  numVillagers: number;
}

interface CommitDefenseEvent extends BaseEvent {
  timeCommittedDefense: string;
}

interface AttackVillageEvent extends BaseEvent {
  resourceToSteal: number;
  defenderPlayer: Player;
}

interface RevealBattleEvent extends BaseEvent {
  winnerVillageIds: string;
  resourcesExchanged: string;
  amountResourcesExchanged: string;
  attackerPlayer: Player;
  defenderPlayer: Player;
}

type Event =
  | GatherFoodEvent
  | BuildHutEvent
  | ChopWoodEvent
  | CommitDefenseEvent
  | AttackVillageEvent
  | RevealBattleEvent;

interface EventsResponse {
  events: Event[];
}

// Constants
const LAST_PROCESSED_KEY = 'stokefire:last_processed_timestamp';

// GraphQL client setup
const graphqlClient = new GraphQLClient('https://api.stokefire.xyz/graphql');

// Neynar API setup
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_API_URL = 'https://api.neynar.com/v2/farcaster/cast';

// GraphQL query for events after a specific timestamp
const EVENTS_QUERY = gql`
  query GetEvents($timestamp: BigInt!) {
    events(
      orderBy: eventTime
      orderDirection: asc
      where: { eventTime_gt: $timestamp }
    ) {
      id
      eventType
      eventTime
      description
      player {
        username
        displayName
      }
      ... on GatherFood {
        foodAdded
        numVillagers
      }
      ... on BuildHut {
        hutsAdded
      }
      ... on ChopWood {
        woodAdded
        numVillagers
      }
      ... on CommitDefense {
        timeCommittedDefense
      }
      ... on AttackVillage {
        resourceToSteal
        defenderPlayer {
          username
          displayName
        }
      }
      ... on RevealBattle {
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

// Type guard functions
function isGatherFoodEvent(event: Event): event is GatherFoodEvent {
  return event.eventType === 'GATHER_FOOD';
}

function isBuildHutEvent(event: Event): event is BuildHutEvent {
  return event.eventType === 'BUILD_HUT';
}

function isChopWoodEvent(event: Event): event is ChopWoodEvent {
  return event.eventType === 'CHOP_WOOD';
}

function isAttackVillageEvent(event: Event): event is AttackVillageEvent {
  return event.eventType === 'ATTACK_VILLAGE';
}

function isRevealBattleEvent(event: Event): event is RevealBattleEvent {
  return event.eventType === 'REVEAL_BATTLE';
}

// Format event message based on type
function formatEventMessage(event: Event): string {
  const time = formatTimeDifference(event.eventTime);
  const username = `@${event.player.username}`;

  if (isGatherFoodEvent(event)) {
    return `${username} gathered ${event.foodAdded} food with ${event.numVillagers} villagers ${time}`;
  }

  if (isBuildHutEvent(event)) {
    return `${username} built ${event.hutsAdded} hut${event.hutsAdded > 1 ? 's' : ''} ${time}`;
  }

  if (isChopWoodEvent(event)) {
    return `${username} gathered ${event.woodAdded} wood with ${event.numVillagers} villagers ${time}`;
  }

  if (event.eventType === 'COMMIT_DEFENSE') {
    return `${username} committed their defense ${time}`;
  }

  if (isAttackVillageEvent(event)) {
    return `${username} raided @${event.defenderPlayer.username}'s village, tried to steal ${event.resourceToSteal} resources ${time}`;
  }

  if (isRevealBattleEvent(event)) {
    const isAttackerWinner = event.winnerVillageIds.includes(event.attackerPlayer.username);
    const winner = isAttackerWinner ? event.attackerPlayer.username : event.defenderPlayer.username;
    return `${username} revealed battle. @${winner} won ${event.amountResourcesExchanged} ${event.resourcesExchanged} ${time}`;
  }

  return `${username} ${event.description} ${time}`;
}

// Post to Farcaster using Neynar API
async function postToFarcaster(message: string) {
  try {
    await axios.post(NEYNAR_API_URL,
      { text: message },
      {
        headers: {
          'accept': 'application/json',
          'api_key': NEYNAR_API_KEY,
          'content-type': 'application/json'
        }
      }
    );
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
      timestamp: lastTimestamp
    });

    if (response.events?.length > 0) {
      // Sort events by timestamp to ensure chronological order
      const sortedEvents = response.events.sort((a, b) =>
        Number(a.eventTime) - Number(b.eventTime)
      );

      for (const event of sortedEvents) {
        const message = formatEventMessage(event);
        await postToFarcaster(message);
        await updateLastProcessedTimestamp(event.eventTime);
        console.log(`Posted event from ${event.eventTime}`);
      }
    }
  } catch (error) {
    console.error('Error processing events:', error);
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