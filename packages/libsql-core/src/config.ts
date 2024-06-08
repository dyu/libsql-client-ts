import type { Config, IntMode } from "./api.js";
import { LibsqlError } from "./api.js";
import type { Authority } from "./uri.js";
import { parseUri } from "./uri.js";
import { supportedUrlLink } from "./util.js";

export interface ExpandedConfig {
    scheme: ExpandedScheme;
    tls: boolean;
    authority: Authority | undefined;
    path: string;
    authToken: string | undefined;
    encryptionKey: string | undefined;
    syncUrl: string | undefined;
    syncInterval: number | undefined;
    intMode: IntMode;
    fetch: Function | undefined;
}

export type ExpandedScheme = "wss" | "ws" | "https" | "http" | "file";

type queryParamDef = {
    values?: string[];
    update?: (key: string, value: string) => void;
};
type queryParamsDef = { [key: string]: queryParamDef };

const inMemoryMode = ":memory:";

export function expandConfig(
    config: Readonly<Config>,
    preferHttp: boolean,
): ExpandedConfig {
    if (typeof config !== "object") {
        // produce a reasonable error message in the common case where users type
        // `createClient("libsql://...")` instead of `createClient({url: "libsql://..."})`
        throw new TypeError(
            `Expected client configuration as object, got ${typeof config}`,
        );
    }

    let { url, authToken, tls, intMode } = config;
    let connectionQueryParams: string[] = []; // recognized query parameters which we sanitize through white list of valid key-value pairs

    // convert plain :memory: url to URI format to make logic more uniform
    if (url === inMemoryMode) {
        url = "file::memory:";
    }

    // parse url parameters first and override config with update values
    const uri = parseUri(url);
    const originalUriScheme = uri.scheme.toLowerCase();

    let queryParamsDef: queryParamsDef;
    if (uri.authority === undefined && uri.path === inMemoryMode) {
        queryParamsDef = {
            cache: {
                values: ["shared", "private"],
                update: (key, value) =>
                    connectionQueryParams.push(`${key}=${value}`),
            },
        };
    } else {
        queryParamsDef = {
            tls: {
                values: ["0", "1"],
                update: (_, value) => (tls = value === "1"),
            },
            authToken: {
                update: (_, value) => (authToken = value),
            },
        };
    }

    for (const { key, value } of uri.query?.pairs ?? []) {
        if (!Object.hasOwn(queryParamsDef, key)) {
            throw new LibsqlError(
                `Unknown URL query parameter ${JSON.stringify(key)}`,
                "URL_PARAM_NOT_SUPPORTED",
            );
        }
        const queryParamDef = queryParamsDef[key];
        if (
            queryParamDef.values !== undefined &&
            !queryParamDef.values.includes(value)
        ) {
            throw new LibsqlError(
                `Unknown value for the "${key}" query argument: ${JSON.stringify(value)}. Supported values are: ${queryParamDef.values}`,
                "URL_INVALID",
            );
        }
        if (queryParamDef.update !== undefined) {
            queryParamDef?.update(key, value);
        }
    }

    // fill defaults & validate config
    let path =
        uri.path +
        (connectionQueryParams.length === 0
            ? ""
            : `?${connectionQueryParams.join("&")}`);
    let scheme: string;
    if (originalUriScheme === "libsql") {
        if (tls === false) {
            if (uri.authority?.port === undefined) {
                throw new LibsqlError(
                    'A "libsql:" URL with ?tls=0 must specify an explicit port',
                    "URL_INVALID",
                );
            }
            scheme = preferHttp ? "http" : "ws";
        } else {
            scheme = preferHttp ? "https" : "wss";
        }
    } else {
        scheme = originalUriScheme;
    }

    intMode ??= "number";
    if (scheme === "http" || scheme === "ws") {
        tls ??= false;
    } else {
        tls ??= true;
    }

    if (
        scheme !== "http" &&
        scheme !== "ws" &&
        scheme !== "https" &&
        scheme !== "wss" &&
        scheme !== "file"
    ) {
        throw new LibsqlError(
            'The client supports only "libsql:", "wss:", "ws:", "https:", "http:" and "file:" URLs, ' +
                `got ${JSON.stringify(uri.scheme + ":")}. ` +
                `For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }
    if (intMode !== "number" && intMode !== "bigint" && intMode !== "string") {
        throw new TypeError(
            `Invalid value for intMode, expected "number", "bigint" or "string", got ${JSON.stringify(intMode)}`,
        );
    }
    if (uri.fragment !== undefined) {
        throw new LibsqlError(
            `URL fragments are not supported: ${JSON.stringify("#" + uri.fragment)}`,
            "URL_INVALID",
        );
    }

    // todo: libsql-client-ts may want to validate parameters for the "in-memory" mode and throw if some of them filled unexpectedly
    // but, in order to not break compatibility between clients for now client doesn't do these validations and just ignore parameters
    const isInMemoryMode =
        uri.scheme === "file" &&
        uri.path === inMemoryMode &&
        uri.authority === undefined;
    if (isInMemoryMode) {
        return {
            scheme: "file",
            tls: false,
            path,
            intMode,
            syncUrl: config.syncUrl,
            syncInterval: config.syncInterval,
            fetch: config.fetch,
            authToken: undefined,
            encryptionKey: undefined,
            authority: undefined,
        };
    }

    return {
        scheme,
        tls: tls,
        authority: uri.authority,
        path,
        authToken,
        intMode,
        encryptionKey: config.encryptionKey,
        syncUrl: config.syncUrl,
        syncInterval: config.syncInterval,
        fetch: config.fetch,
    };
}
