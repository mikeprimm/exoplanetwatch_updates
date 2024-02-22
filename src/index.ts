import { DynamoDBClient } from "@aws-sdk/client-dynamodb/dist-cjs/DynamoDBClient";
import { ProvisionedThroughputExceededException } from "@aws-sdk/client-dynamodb/dist-cjs/models";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb/dist-cjs/DynamoDBDocumentClient";
import { QueryCommand, QueryCommandInput } from "@aws-sdk/lib-dynamodb/dist-cjs/commands/QueryCommand";
import { GetCommandInput, GetCommand } from "@aws-sdk/lib-dynamodb/dist-cjs/commands/GetCommand";
import { PutCommandInput } from "@aws-sdk/lib-dynamodb/dist-cjs/commands/PutCommand";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb/dist-cjs/models";
import got from "got";

const MAXIMUM_ATTEMPTS = 6;
const DDBTABLE_ExoplanetWatchConfig = "ExoplanetWatchConfig";
const DDBTABLE_ExoplanetWatchState = "ExoplanetWatchState";

const ExoplanetWatchConfig_ConfigID = "base";
const EPWData_URL = "https://exoplanets.nasa.gov/api/v1/exoplanet_watch_results/?per_page=-1&order=planet_name+asc";

interface ExoplanetWatchConfig {
    configID: string,
    stackURLs: string[] // List of Webhook URLs to be posted to
};

function configMapper(item: Record<string, NativeAttributeValue>): ExoplanetWatchConfig {
    return { configID: item.configID, stackURLs: item.stackURLs };
}

export const getDDB = (() => {
    let ddb: DynamoDBClient;
	return () => ddb = (ddb || 
        new DynamoDBClient({ region: process.env.AWS_REGION, maxAttempts: MAXIMUM_ATTEMPTS }))
})();
export const getDDBDocClient = (() => {
    let ddbdoc: DynamoDBDocumentClient;
	return () => ddbdoc = (ddbdoc || 
        DynamoDBDocumentClient.from(getDDB(), { 
            marshallOptions: { convertEmptyValues: false, removeUndefinedValues: true, convertClassInstanceToMap: false },
            unmarshallOptions: { wrapNumbers: false } }))
})();

export async function getFull<T>(get: GetCommandInput,
    mapper: (item: Record<string, NativeAttributeValue>) => T): Promise<T> {
    const startTS = Date.now();
    const ddbDocClient = getDDBDocClient();
    let delay = 500;

    async function getItem(): Promise<T> {
        let params = get;
        let item: T = null;
        try {
            const res = await ddbDocClient.send(new GetCommand(params));
            if (res && res.Item) {
                item = mapper(res.Item);
            }
            return item;
        }
        catch (err) {
            if (err instanceof ProvisionedThroughputExceededException) {
                delay = delay * 2;
                return await new Promise(
                    (resolve, reject) => setTimeout(() => getItem().then(resolve).catch(reject), delay)
                );
            }
            else {
                console.log(`getFull<${get.TableName}> EXCEPTION: ${err.message}`);
                console.log(`params=${JSON.stringify(params)}`);
                throw err;
            }
        }
    }
    let rslt = await getItem();
    return rslt;
}

export async function getByKey<T>(tableName: string,
    keyParams: Record<string, NativeAttributeValue>,
    mapper: (item: Record<string, NativeAttributeValue>) => T): Promise<T> {
    const ddbDocClient = getDDBDocClient();
    let rc: T = null;
    let params: GetCommandInput = {
        TableName: tableName,
        Key: keyParams
    };
    try {
        let data = await ddbDocClient.send(new GetCommand(params));
        if (data && data.Item) {
            rc = mapper(data.Item);
        }
    }
    catch (err) {
        console.log(`getByKey<${tableName}> EXCEPTION: ${err.message}`);
        console.log(`params=${JSON.stringify(params)}`);
        throw err;
    }
    return rc;
}
interface EPWObserver {
    id: string,
    org: string,
    "link-obs": string,
    "link-org": string,
    "link-collab": string,
};

interface EPWData {
    items: { 
        // Key is planet ID
        [key: string]: {
            host: string,   // Star ID
            name: string,   // Planet ID
            priors: { [key: string]: { 
                units: string, 
                value: string, 
                reference: string, 
                uncertainty: string } },
            ephemeris: { [key: string]: string },
            timestamp: string,  // ISO datetime
            identifier: string,
            observations: {
                files: { [key: string]: string },
                errors: { [key: string]: string },
                filter: {
                    desc: string,
                    fwhm: {
                        units: string,
                        value: string,
                    }[],
                    name: string,
                },
                obscode: EPWObserver,
                identifier: string,
                parameters: { [key: string]: string },
                secondary_obscodes: EPWObserver[],
                data_flag_ephemeris: boolean
            }[],
        } 
    }[],
};

async function getExoplanetWatchData(): Promise<EPWData> {
    return got.get<EPWData>(EPWData_URL, 
        {   headers: { Accept: 'application/json' },
            timeout: { lookup: 10000, socket: 10000, connect: 10000, secureConnect: 10000 },
        }).json<EPWData>();
}

// Periodic handler
export async function handler(event: AWSLambda.ScheduledEvent, context): Promise<any> { 
    try {
        // Fetch base config record
        let config = await getByKey<ExoplanetWatchConfig>(DDBTABLE_ExoplanetWatchConfig, 
            { configID: ExoplanetWatchConfig_ConfigID }, configMapper);
        if (!config) {
            console.log(`ERROR: No default config record (configID=${ExoplanetWatchConfig_ConfigID}) found in ${DDBTABLE_ExoplanetWatchConfig}`);
            return;
        }
        let epwdata = await getExoplanetWatchData();
        for (let itm of epwdata.items) {
            let rec = Object.values(itm)[0];
            if (!rec) continue;
            console.log(`${rec.identifier}: host=${rec.host}, name=${rec.name}, #obs=${rec.observations.length}`);
        }
    } catch (err) {
        console.log(`ERROR: ${err.message}`, err);
    }
}
