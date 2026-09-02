import { Connection, Document, Model, Schema } from 'mongoose';

export type NetScheduleType = 'oneTime' | 'weekly' | 'monthlyPosition' | 'monthlyDate';

export interface NetSchedule extends Document {
    netProfile: Schema.Types.ObjectId;
    type: NetScheduleType;
    timezone: string;
    localStartTime: string;
    startDate: string;
    endDate?: string;
    weekdays?: number[];
    monthlyOrdinal?: 1 | 2 | 3 | 4 | 5 | -1;
    monthlyWeekday?: number;
    monthlyDay?: number;
    enabled: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

export const netScheduleSchema: Schema<NetSchedule>;
export function getNetSchedule(db?: Connection): Model<NetSchedule>;
