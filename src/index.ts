import got from "got";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb/dist-cjs/models";
import { getByKey, putRecord, putSafe } from "./ddb";
import { EPWData, EPWObservation, EPWTargetData } from "./epwTypes";

const DDBTABLE_ExoplanetWatchConfig = "ExoplanetWatchConfig";
const DDBTABLE_ExoplanetWatchState = "ExoplanetWatchState";

const ExoplanetWatchConfig_ConfigID = "base";
const EPWData_URL = "https://exoplanets.nasa.gov/api/v1/exoplanet_watch_results/?per_page=-1&order=planet_name+asc";

interface ExoplanetWatchConfig {
    configID: string,
    slackURLs: string[] // List of Webhook URLs to be posted to
    firstPassDone: boolean,
};

interface ExoplanetWatchState {
    targetID: string,
    observationIDs: string[],
};

function configMapper(item: Record<string, NativeAttributeValue>): ExoplanetWatchConfig {
    return { configID: item.configID, slackURLs: item.slackURLs, firstPassDone: !!item.firstPassDone };
}
function stateMapper(item: Record<string, NativeAttributeValue>): ExoplanetWatchState {
    return { targetID: item.targetID, observationIDs: item.observationIDs };
}

async function getExoplanetWatchData(): Promise<EPWData> {
    return got.get<EPWData>(EPWData_URL, 
        {   headers: { Accept: 'application/json' },
            timeout: { lookup: 10000, socket: 10000, connect: 10000, secureConnect: 10000 },
        }).json<EPWData>();
}

async function reportObservation(obs: EPWObservation, rec: EPWTargetData, cfg: ExoplanetWatchConfig) {
    if (cfg.firstPassDone) {
        let obscode: string = obs.obscode.id;
        if (obs.secondary_obscodes?.length) {
            let ids = obs.secondary_obscodes.map(v => v.id);
            obscode = `${obscode} (and secondary ${ids.length == 1 ? "observer" : "observers"} ${ids.join(',')})`;
        }
        let msg = { text: `Observation of planet ${rec.name} of star ${rec.host} by observer ${obscode} with Tmid=${obs.parameters.Tc} added to Exoplanet Watch Database.` };
        if (obs.data_flag_ephemeris) {
            msg.text += " Observation is included in ephemeris calculations.";
        }
        msg.text += "\n";
        for (let tgt of (cfg.slackURLs || [])) {
            let rslt = await got.post(tgt, {
                headers: { 
                    "Content-Type": 'application/json'},
                json: msg,
                timeout: { lookup: 10000, socket: 10000, connect: 10000, secureConnect: 10000 },
            });
        }
    }
}

async function handleTarget(rec: EPWTargetData, cfg: ExoplanetWatchConfig) {
    if (!rec) return;
    // Get state record for target
    let state = await getByKey<ExoplanetWatchState>(DDBTABLE_ExoplanetWatchState, 
        { targetID: rec.identifier }, stateMapper);
    let knownObservationIDs = new Set<string>(state?.observationIDs || []);
    let addedNew = false;
    for (let obs of rec.observations) {
        // Skip known ones
        if (knownObservationIDs.has(obs.identifier)) continue;
        addedNew = true;
        knownObservationIDs.add(obs.identifier);
        // And report new addition
        await reportObservation(obs, rec, cfg);
    }
    if (addedNew) {
        await putRecord<ExoplanetWatchState>(DDBTABLE_ExoplanetWatchState, 
            { targetID: rec.identifier, observationIDs: Array.from(knownObservationIDs) });
    }
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
        // Process all records
        await Promise.all(
            epwdata.items.map(itm => handleTarget(Object.values(itm)[0], config))
        );
        // If first pass wasn't done, mark it done
        if (!config.firstPassDone) {
            config.firstPassDone = true;
            await putRecord<ExoplanetWatchConfig>(DDBTABLE_ExoplanetWatchConfig, config);    
        }
    } catch (err) {
        console.log(`ERROR: ${err.message}`, err);
    }
}
