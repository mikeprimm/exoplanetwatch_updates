import { DynamoDBClient, ProvisionedThroughputExceededException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommandInput, GetCommand, 
    PutCommandInput, PutCommand, } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";

const MAXIMUM_ATTEMPTS = 6;

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


// PUT with retries, returns previous value if ALL_OLD specified
export async function putSafe<T>(put: PutCommandInput, mapper?: (item: Record<string, NativeAttributeValue>) => T): Promise<T> {
    let delay = 500;
    const ddbDocClient = getDDBDocClient();

    async function putItem(): Promise<T> {
        let params = put;
        let item: T = null;
        try {
            const res = await ddbDocClient.send(new PutCommand(params));
            if (res && res.Attributes && mapper) {
                item = mapper(res.Attributes);
            }
            return item;
        }
        catch (err) {
            if (err instanceof ProvisionedThroughputExceededException) {
                delay = delay * 2;
                return await new Promise(
                    (resolve, reject) => setTimeout(() => putItem().then(resolve).catch(reject), delay)
                );
            }
            else {
                console.log(`putSafe<${put.TableName}> EXCEPTION: ${err.message}`);
                console.log(`params=${JSON.stringify(params)}`);
                throw err;
            }
        }
    }
    return await putItem();
}


// Put 
export async function putRecord<T>(tableName: string, object: T): Promise<void> {
    const startTS = Date.now();
    let parms: PutCommandInput = {
        TableName: tableName,
        Item: object,
    };
    await putSafe<T>(parms);
}
