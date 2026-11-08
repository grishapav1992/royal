import { createHash } from 'node:crypto';
import { canonicalChatMessageId, parseChatV2Visit, type ChatLocation } from '../src/shared/chat';
import type { ClubSanction } from '../src/shared/security';
import { SKIN_UUID } from '../src/shared/skinStudio';
import { normalizeExpiredClubSanction, readClubGameTime, type ClubConductState } from './chatGameAuthorization';
import type { ClubSanctionStore } from './clubSanctions';
import type { PostgresDatabase } from './database';
import { applySchemaMigration } from './database-migrations';

export const CLUB_CHAT_SANCTION_COMMAND_VERSION = 1;

type ClubChatSanctionInput = Readonly<{
  accountId: string;
  messageId: string;
  roomEpoch: string;
  visitId: number;
  location: ChatLocation;
  reason: 'spam' | 'profanity';
  clearanceGeneration: number;
  equippedSkinId: string | null;
}>;

export type ClubChatSanctionCommand = ClubChatSanctionInput & Readonly<{
  version: typeof CLUB_CHAT_SANCTION_COMMAND_VERSION;
  eventId: string;
}>;

type CommandIdentity = Readonly<Pick<ClubChatSanctionCommand, 'version' | 'eventId'>>;
type ReceiptIdentity = CommandIdentity & Readonly<{ state: ClubConductState }>;
type Applied = ReceiptIdentity & Readonly<{
  status: 'applied';
  sanction: ClubSanction;
  opened: boolean;
  revealedSkinId: string | null;
  pursuitId: string | null;
}>;
type Receipt = Applied | (ReceiptIdentity & Readonly<{ status: 'obsolete' }>);
export type ClubChatSanctionResult = Receipt | (CommandIdentity & Readonly<{ status: 'id_conflict' }>);
export type ClubChatSanctionRoomEvent = Readonly<{ command: ClubChatSanctionCommand; receipt: Applied }>;

function digest(fields: readonly unknown[]) {
  return createHash('sha256').update(JSON.stringify(fields), 'utf8').digest('hex');
}

export function createClubChatSanctionCommand(input: ClubChatSanctionInput): ClubChatSanctionCommand {
  const { accountId, clearanceGeneration, equippedSkinId, reason } = input;
  const messageId = canonicalChatMessageId(input.messageId);
  const visit = parseChatV2Visit({ roomEpoch: input.roomEpoch, visitId: input.visitId, location: input.location, initialCursor: 0 });
  if (typeof accountId !== 'string' || !accountId || accountId.length > 128 || /[\s\u0000-\u001f\u007f]/u.test(accountId)
    || !messageId || !visit || (reason !== 'spam' && reason !== 'profanity')
    || !Number.isSafeInteger(clearanceGeneration) || clearanceGeneration < 0
    || !(equippedSkinId === null || typeof equippedSkinId === 'string' && equippedSkinId.length === 36 && SKIN_UUID.test(equippedSkinId))) {
    throw new RangeError('Invalid club chat sanction command');
  }
  return Object.freeze({
    version: CLUB_CHAT_SANCTION_COMMAND_VERSION,
    eventId: digest(['royal-club-chat-sanction', accountId, messageId]),
    accountId, messageId, roomEpoch: visit.roomEpoch, visitId: visit.visitId, location: visit.location,
    reason, clearanceGeneration, equippedSkinId: equippedSkinId?.toLowerCase() ?? null,
  });
}

function parseCommand(value: unknown): ClubChatSanctionCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'accountId,clearanceGeneration,equippedSkinId,eventId,location,messageId,reason,roomEpoch,version,visitId') {
    throw new RangeError('Invalid club chat sanction command');
  }
  const input = value as ClubChatSanctionCommand;
  const command = createClubChatSanctionCommand(input);
  if (input.version !== command.version || input.eventId !== command.eventId) {
    throw new RangeError('Invalid club chat sanction command identity');
  }
  return command;
}

export function fingerprintClubChatSanctionCommand(command: ClubChatSanctionCommand): string {
  return digest([command.version, command.eventId, command.accountId, command.messageId, command.roomEpoch,
    command.visitId, command.location, command.reason, command.clearanceGeneration, command.equippedSkinId]);
}

async function readConductState(db: PostgresDatabase, accountId: string): Promise<ClubConductState> {
  const row = await db.prepare('SELECT clearance_generation,state_version FROM club_conduct_state WHERE account_id=?').get(accountId);
  if (!row) return { clearanceGeneration: 0, stateVersion: 0 };
  const clearanceGeneration = Number(row.clearance_generation), stateVersion = Number(row.state_version);
  if (!Number.isSafeInteger(clearanceGeneration) || !Number.isSafeInteger(stateVersion)
    || clearanceGeneration < 0 || stateVersion < clearanceGeneration) throw new Error('Invalid club conduct state');
  return { clearanceGeneration, stateVersion };
}

/** The game owns this receipt and outbox. Delivery happens after the account transaction commits. */
export class ClubChatSanctionCommands {
  readonly ready: Promise<void>;

  constructor(private readonly db: PostgresDatabase, private readonly sanctions: ClubSanctionStore,
    private readonly now?: () => number) {
    if (!sanctions.usesDatabase(db)) throw new Error('Club chat commands must share the sanction transaction');
    this.ready = sanctions.ready.then(() => applySchemaMigration(db, {
      id: 'game-club-chat-commands-v1',
      statements: [
        `CREATE TABLE IF NOT EXISTS club_chat_sanction_receipts (
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          event_id TEXT NOT NULL CHECK (event_id ~ '^[a-f0-9]{64}$'),
          fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
          command JSONB NOT NULL,
          receipt JSONB NOT NULL,
          PRIMARY KEY (account_id, event_id)
        )`,
        `CREATE TABLE IF NOT EXISTS club_chat_room_outbox (
          event_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          room_epoch TEXT NOT NULL,
          payload JSONB NOT NULL,
          created_at BIGINT NOT NULL,
          delivered_at BIGINT,
          FOREIGN KEY (account_id, event_id) REFERENCES club_chat_sanction_receipts(account_id, event_id) ON DELETE CASCADE
        )`,
        'CREATE INDEX IF NOT EXISTS club_chat_room_outbox_pending ON club_chat_room_outbox (room_epoch, created_at, event_id) WHERE delivered_at IS NULL',
      ],
    }));
  }

  async apply(value: unknown): Promise<ClubChatSanctionResult> {
    const command = parseCommand(value);
    const { version, eventId, accountId } = command;
    const identity = { version, eventId };
    const fingerprint = fingerprintClubChatSanctionCommand(command);
    await this.ready;
    return this.db.transaction(async () => {
      const prior = await this.db.prepare('SELECT fingerprint,receipt FROM club_chat_sanction_receipts WHERE account_id=? AND event_id=?')
        .get(accountId, eventId);
      if (prior) return prior.fingerprint === fingerprint ? prior.receipt as Receipt : { ...identity, status: 'id_conflict' };

      // Read the same game clock used at admission, after taking the account lock.
      const appliedAt = this.now?.() ?? await readClubGameTime(this.db);
      const state = await normalizeExpiredClubSanction(this.db, accountId, { now: appliedAt })
        ?? await readConductState(this.db, accountId);
      if (command.clearanceGeneration < state.clearanceGeneration) {
        const receipt = { ...identity, status: 'obsolete', state } as const;
        await this.save(command, fingerprint, receipt);
        return receipt;
      }
      if (command.clearanceGeneration > state.clearanceGeneration) {
        throw new RangeError('Club chat sanction generation is ahead of game state');
      }

      const pursuitId = command.location === 'toilet' ? null : 'chat-v2:' + eventId;
      const { outcome, replayed } = await this.sanctions.recordViolation(accountId, {
        id: 'chat-v2:' + eventId, reason: command.reason,
        pursuitId: pursuitId ?? undefined, equippedSkinId: command.equippedSkinId,
      }, appliedAt);
      if (replayed) throw new Error('Club chat sanction event has no matching command receipt');
      const receipt: Applied = { ...identity, status: 'applied', state: await readConductState(this.db, accountId),
        sanction: outcome.sanction, opened: outcome.opened, revealedSkinId: outcome.revealedSkinId ?? null, pursuitId };
      const payload: ClubChatSanctionRoomEvent = { command, receipt };
      await this.save(command, fingerprint, receipt);
      await this.db.prepare(`INSERT INTO club_chat_room_outbox (event_id,account_id,room_epoch,payload,created_at)
        VALUES (?,?,?,?::jsonb,?)`).run(eventId, accountId, command.roomEpoch, JSON.stringify(payload), appliedAt);
      return receipt;
    }, { lockKey: 'account:' + accountId });
  }

  private save(command: ClubChatSanctionCommand, fingerprint: string, receipt: Receipt) {
    return this.db.prepare(`INSERT INTO club_chat_sanction_receipts (account_id,event_id,fingerprint,command,receipt)
      VALUES (?,?,?,?::jsonb,?::jsonb)`).run(command.accountId, command.eventId, fingerprint,
        JSON.stringify(command), JSON.stringify(receipt));
  }
}
