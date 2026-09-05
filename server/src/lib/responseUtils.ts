/* hamlive-oss — MIT License. See LICENSE. */

import { Response } from 'express';
import { EndPointResponse } from '#@client/types/commonTypes.js';
import hash from 'object-hash';
import { isEndPointResponse, isFlexOptions } from '#@server/types/commonTypesupport.js';
import { logger } from '#@server/lib/logger.js';

enum HttpStatus {
    OK = 200,
    MOVED_PERMANENTLY = 301,
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    UNSUPPORTED_MEDIA_TYPE = 415,
    INTERNAL_SERVER_ERROR = 500,
    NOT_IMPLEMENTED = 501
    // Add other status codes as needed
}

const endpointVersion = '1.0';
const oHashOptions = {
    respectType: false,
    ignoreUnknown: true
};

//Used by ResponseHandler and external SSE endpoints
export const prepareEndPointResponse = (
    data: object,
    errorMessage?: string,
    ssePath?: string | null,
    ttlMs?: number
): EndPointResponse => {
    if (ttlMs === undefined) {
        logger.warn('Warning: ttlMs is not provided. Defaulting to 5000.');
        ttlMs = 5000;
    }

    const response: EndPointResponse = {
        ...data,
        endpointVersion,
        now: new Date().toISOString(),
        ssePath: ssePath === undefined ? null : ssePath,
        ttlMs,
        hash: '' // Add the 'hash' property here
    };

    if (errorMessage) {
        response.errorMessage = errorMessage;
        response.errorHash = hash(errorMessage, oHashOptions);
    } else {
        response.hash = hash(data, oHashOptions);
    }

    return response;
};

interface ResponseHandlerOptions {
    ssePath?: string | null;
    ttlMs: number;
}

export class ResponseHandler {
    private ssePath: string | null;
    private _ttlMs: number = 0;

    constructor({ ssePath, ttlMs }: ResponseHandlerOptions) {
        this.ssePath = ssePath === undefined ? null : ssePath;
        this.validateAndSetTtlMs(ttlMs);
    }

    set ttlMs(value: number) {
        this.validateAndSetTtlMs(value);
    }

    get ttlMs(): number {
        return this._ttlMs;
    }

    private validateAndSetTtlMs(value: number) {
        if (typeof value !== 'number' || value <= 0) {
            throw new Error('ttlMs must be a number greater than 0');
        }
        this._ttlMs = value;
    }

    private prepareResponse(data: object, errorMessage?: string): EndPointResponse {
        return prepareEndPointResponse(data, errorMessage, this.ssePath, this._ttlMs);
    }

    sendResponse(res: Response, status: keyof typeof HttpStatus, data: object | EndPointResponse) {
        if (!HttpStatus[status]) {
            throw new Error(`Invalid status code: ${status}`);
        }

        let response: EndPointResponse;

        if (isEndPointResponse(data)) {
            response = data;
        } else if (typeof data === 'object') {
            response = this.prepareResponse(data);
        } else {
            logger.error(`Received invalid data: ${JSON.stringify(data)} in sendResponse`);
            throw new Error('Data must be an object or an EndPointResponse');
        }

        return res.status(HttpStatus[status]).json(response);
    }

    sendError(res: Response, status: keyof typeof HttpStatus, message: string) {
        if (!HttpStatus[status]) {
            throw new Error(`Invalid status code: ${status}`);
        }

        const publicMessage = status === 'INTERNAL_SERVER_ERROR' || status === 'NOT_IMPLEMENTED'
            ? 'The request could not be completed'
            : message;
        const response = this.prepareResponse({}, publicMessage);
        return res.status(HttpStatus[status]).json(response);
    }
}

export const handleRequest = async (
    res: Response,
    callback: () => Promise<object | EndPointResponse>,
    successMessage?: string
) => {
    if (!isFlexOptions(res.locals['flexOpts'])) {
        throw new Error('Flex options are not set in the response locals');
    }

    const handleResponse = new ResponseHandler({ ttlMs: res.locals['flexOpts'].baseTtlMs });

    try {
        const result = await callback();
        if (successMessage) logger.info(successMessage);
        handleResponse.sendResponse(res, 'OK', result);
    } catch (err) {
        const errorMessage =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'An unknown error occurred';
        handleResponse.sendError(res, 'INTERNAL_SERVER_ERROR', 'The request could not be completed');
        logger.error(err instanceof Error ? err.stack : errorMessage);
    }
};
