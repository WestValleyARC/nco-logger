import { Document, Schema, Connection, Model } from 'mongoose';
import { FlexOptions } from './flexOptions';
import { InitialReg } from './initialRegTracker';
import { NetProfile } from './netProfile';

export interface UserProfile extends Document<string> {
    displayName: string;
    googleId?: string;
    lastLogin: Date;
    callSign?: string;
    photo?: string;
    location?: string;
    newAccount: boolean;
    lastAuthVia: 'google' | 'email';
    policyConsent: boolean;
    flaggedForDeletion: boolean;
    inactivityWarningSentAt?: Date | null;
    deletionReason?: 'manual' | 'inactivity' | 'missing-consent' | null;
    email: string;
    locked: boolean;
    superUser: boolean;
    verified: boolean;
    flexOptions?: FlexOptions;
    initialReg?: InitialReg;
    myNets?: NetProfile[];
    following?: NetProfile[];
    createdAt?: Date;
    updatedAt?: Date;
}

export const userProfileSchema: Schema<UserProfile>;

export function getUserProfile(db?: Connection): Model<UserProfile>;
