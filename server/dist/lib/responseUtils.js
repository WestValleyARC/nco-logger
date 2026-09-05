"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRequest = exports.ResponseHandler = exports.prepareEndPointResponse = void 0;
const object_hash_1 = __importDefault(require("object-hash"));
const commonTypesupport_js_1 = require("#@server/types/commonTypesupport.js");
const logger_js_1 = require("#@server/lib/logger.js");
var HttpStatus;
(function (HttpStatus) {
    HttpStatus[HttpStatus["OK"] = 200] = "OK";
    HttpStatus[HttpStatus["MOVED_PERMANENTLY"] = 301] = "MOVED_PERMANENTLY";
    HttpStatus[HttpStatus["BAD_REQUEST"] = 400] = "BAD_REQUEST";
    HttpStatus[HttpStatus["UNAUTHORIZED"] = 401] = "UNAUTHORIZED";
    HttpStatus[HttpStatus["FORBIDDEN"] = 403] = "FORBIDDEN";
    HttpStatus[HttpStatus["NOT_FOUND"] = 404] = "NOT_FOUND";
    HttpStatus[HttpStatus["UNSUPPORTED_MEDIA_TYPE"] = 415] = "UNSUPPORTED_MEDIA_TYPE";
    HttpStatus[HttpStatus["INTERNAL_SERVER_ERROR"] = 500] = "INTERNAL_SERVER_ERROR";
    HttpStatus[HttpStatus["NOT_IMPLEMENTED"] = 501] = "NOT_IMPLEMENTED";
})(HttpStatus || (HttpStatus = {}));
const endpointVersion = '1.0';
const oHashOptions = {
    respectType: false,
    ignoreUnknown: true
};
const prepareEndPointResponse = (data, errorMessage, ssePath, ttlMs) => {
    if (ttlMs === undefined) {
        logger_js_1.logger.warn('Warning: ttlMs is not provided. Defaulting to 5000.');
        ttlMs = 5000;
    }
    const response = {
        ...data,
        endpointVersion,
        now: new Date().toISOString(),
        ssePath: ssePath === undefined ? null : ssePath,
        ttlMs,
        hash: ''
    };
    if (errorMessage) {
        response.errorMessage = errorMessage;
        response.errorHash = (0, object_hash_1.default)(errorMessage, oHashOptions);
    }
    else {
        response.hash = (0, object_hash_1.default)(data, oHashOptions);
    }
    return response;
};
exports.prepareEndPointResponse = prepareEndPointResponse;
class ResponseHandler {
    ssePath;
    _ttlMs = 0;
    constructor({ ssePath, ttlMs }) {
        this.ssePath = ssePath === undefined ? null : ssePath;
        this.validateAndSetTtlMs(ttlMs);
    }
    set ttlMs(value) {
        this.validateAndSetTtlMs(value);
    }
    get ttlMs() {
        return this._ttlMs;
    }
    validateAndSetTtlMs(value) {
        if (typeof value !== 'number' || value <= 0) {
            throw new Error('ttlMs must be a number greater than 0');
        }
        this._ttlMs = value;
    }
    prepareResponse(data, errorMessage) {
        return (0, exports.prepareEndPointResponse)(data, errorMessage, this.ssePath, this._ttlMs);
    }
    sendResponse(res, status, data) {
        if (!HttpStatus[status]) {
            throw new Error(`Invalid status code: ${status}`);
        }
        let response;
        if ((0, commonTypesupport_js_1.isEndPointResponse)(data)) {
            response = data;
        }
        else if (typeof data === 'object') {
            response = this.prepareResponse(data);
        }
        else {
            logger_js_1.logger.error(`Received invalid data: ${JSON.stringify(data)} in sendResponse`);
            throw new Error('Data must be an object or an EndPointResponse');
        }
        return res.status(HttpStatus[status]).json(response);
    }
    sendError(res, status, message) {
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
exports.ResponseHandler = ResponseHandler;
const handleRequest = async (res, callback, successMessage) => {
    if (!(0, commonTypesupport_js_1.isFlexOptions)(res.locals['flexOpts'])) {
        throw new Error('Flex options are not set in the response locals');
    }
    const handleResponse = new ResponseHandler({ ttlMs: res.locals['flexOpts'].baseTtlMs });
    try {
        const result = await callback();
        if (successMessage)
            logger_js_1.logger.info(successMessage);
        handleResponse.sendResponse(res, 'OK', result);
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : 'An unknown error occurred';
        handleResponse.sendError(res, 'INTERNAL_SERVER_ERROR', 'The request could not be completed');
        logger_js_1.logger.error(err instanceof Error ? err.stack : errorMessage);
    }
};
exports.handleRequest = handleRequest;
