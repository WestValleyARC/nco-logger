/* hamlive-oss — MIT License. See LICENSE. */

export type BackgroundTasks = {
    closeIdleNets: {
        enabled: boolean;
        options: Record<string, never>;
    };
    flagAccounts: {
        enabled: boolean;
        options: {
            inactivity_years: number;
            inactivity_warning_days: number;
            account_create_min: number;
        };
    };
    deleteFlaggedAccounts: {
        enabled: boolean;
        options: null;
    };
    processUnfollowJobs: {
        enabled: boolean;
        options: null;
    };
};

// eslint-disable-next-line
export type NetadminCommands = {
    [command: string]: {
        enabled: boolean;
    };
};

// eslint-disable-next-line
export type Config = {
    applogname: string;
    qrz_username: string;
    qrz_password: string;
    qrz_version: number;
    qrz_keep_profile_images: boolean;
    qrz_image_host: string;
    qrz_endpoint: string;
    qrz_cache_ttl_hours: number;
    geo_endpoint: string;
    geo_key: string;
    re_gen_global_flex_ops: boolean;
    google_client_id: string;
    google_client_secret: string;
    cookie_session_key: string;
    magic_link_secret: string;
    mail_transport: string;
    smtp_host: string;
    smtp_port: string;
    smtp_secure: string;
    smtp_require_tls: string;
    smtp_user: string;
    smtp_pass: string;
    email_from: string;
    email_reply_to: string;
    chat_max_message_chars: number;
    chat_rate_limit_count: number;
    chat_rate_limit_window_ms: number;
    chat_upload_dir: string;
    chat_max_upload_mb: number;
    nco_abandonment_minutes: number;
    nodeenv: string;
    port: number;
    run_background_tasks_on_startup: boolean;
    realtime_mongoose_poolsize: number;
    change_stream_poolsize: number;
    dbname: string;
    dburi: string;
    batch_mongoose_poolsize: number;
    base_url: string;
    background_tasks: BackgroundTasks;
    netadmin_commands: NetadminCommands;
};

declare const conf: Config;

export { conf };
