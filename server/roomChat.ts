import { isChatLocation, type ChatLocation, type ChatVisit } from '../src/shared/chat';
import type { ChatMessage } from '../src/shared/world';

export type ChatStamp = { hall: ChatLocation; sequence: number };
type Entry = { stamp: ChatStamp; message: ChatMessage };

export class RoomChat {
  private sequence = 0;
  private readonly visits = new Map<string, ChatVisit>();
  private readonly history = new Map<ChatLocation, Entry[]>();

  visit(id: string) { return this.visits.get(id); }
  leave(id: string) { this.visits.delete(id); }

  enter(id: string, hall: string): ChatVisit | undefined {
    if (!isChatLocation(hall)) { this.leave(id); return; }
    const previous = this.visit(id);
    if (previous?.hall === hall) return previous;
    const visit = { id: ++this.sequence, hall };
    this.visits.set(id, visit);
    return visit;
  }

  stamp(hall: ChatLocation): ChatStamp { return { hall, sequence: ++this.sequence }; }

  append(stamp: ChatStamp, message: ChatMessage) {
    const entries = this.history.get(stamp.hall) ?? [];
    entries.push({ stamp, message });
    if (entries.length > 60) entries.shift();
    this.history.set(stamp.hall, entries);
  }

  deliver(visit: ChatVisit, stamp: ChatStamp, message: ChatMessage): ChatMessage | undefined {
    if (visit.hall === stamp.hall && visit.id < stamp.sequence) return { ...message, visitId: visit.id };
  }

  read(visit: ChatVisit): ChatMessage[] {
    return (this.history.get(visit.hall) ?? []).flatMap(({ stamp, message }) => this.deliver(visit, stamp, message) ?? []);
  }
}
