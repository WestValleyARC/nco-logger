import { Connection, Document, Model, Schema } from 'mongoose';

export type OccurrenceStatus = 'scheduled' | 'preparing' | 'live' | 'completed' | 'cancelled' | 'missed';
export type NotificationState = 'pending' | 'claimed' | 'sent' | 'failed';

export interface ScheduledOccurrence extends Document {
    schedule: Schema.Types.ObjectId;
    netProfile: Schema.Types.ObjectId;
    occurrenceKey: string;
    originalStartAt: Date;
    startAt: Date;
    isOverride: boolean;
    status: OccurrenceStatus;
    liveNet?: Schema.Types.ObjectId;
    preparedAt?: Date | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
    cancelledAt?: Date | null;
    missedAt?: Date | null;
    cancelledBy?: Schema.Types.ObjectId;
    notification: {
        state: NotificationState;
        claimedAt?: Date | null;
        sentAt?: Date | null;
        failedAt?: Date | null;
        attempts: number;
    };
    createdAt?: Date;
    updatedAt?: Date;
}

export const scheduledOccurrenceSchema: Schema<ScheduledOccurrence>;
export function getScheduledOccurrence(db?: Connection): Model<ScheduledOccurrence>;
