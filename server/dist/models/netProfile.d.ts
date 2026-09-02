import { Document, Schema, Connection, Model } from 'mongoose';

export type NetConnectionType = 'FM' | 'HF' | 'AllStarLink' | 'EchoLink' | 'DMR' | 'D-STAR' | 'YSF' | 'P25' | 'M17' | 'NXDN' | 'Zello' | 'Other' | 'Legacy';

export interface NetConnection {
    type: NetConnectionType;
    frequency?: string;
    tone?: string;
    operation?: 'Repeater' | 'Simplex';
    offset?: string;
    mode?: 'SSB' | 'USB' | 'LSB' | 'CW' | 'AM' | 'Digital' | 'Other';
    node?: string;
    callsign?: string;
    talkgroup?: string;
    colorCode?: string;
    reflector?: string;
    module?: string;
    room?: string;
    channel?: string;
    label?: string;
    value?: string;
}

export interface NetProfile extends Document {
    title: string;
    frequency?: string;
    mode:
        | 'LSB'
        | 'USB'
        | 'AM'
        | 'CW'
        | 'FM'
        | 'RTTY'
        | 'FSQ'
        | 'PSK-31'
        | 'FreeDV'
        | 'Reflector'
        | 'Olivia'
        | 'Hell'
        | 'JS8Call'
        | 'CUSTOM';
    modeDetails?: string;
    connections?: NetConnection[];
    notes?: string;
    owners: Schema.Types.ObjectId[];
    followers?: Schema.Types.ObjectId[];
    liveNet?: Schema.Types.ObjectId;
    autoIn: boolean;
    permanent: boolean;
    restrictedSigReports: boolean;
    invisible: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

export const netProfileSchema: Schema<NetProfile>;
export const connectionSchema: Schema<NetConnection>;
export const CONNECTION_TYPES: NetConnectionType[];

export function getNetProfile(db?: Connection): Model<NetProfile>;
export function getNetProfileConnections(profile: Partial<NetProfile>): NetConnection[];
export function removeLegacyTitleUniqueIndex(model: Model<NetProfile>): Promise<boolean>;
