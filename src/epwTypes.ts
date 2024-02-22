
export interface EPWObserver {
    id: string,
    org: string,
    "link-obs": string,
    "link-org": string,
    "link-collab": string,
}

export interface EPWObservation {
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
    parameters: { 
        Tc: string,
        u0: string,
        u1: string,
        u2: string,
        u3: string,
        Am1: string,
        Am2: string,
        ecc: string,
        inc: string,
        "a/R*": string,
        "Rp/R*": string,
        omega: string,
        Period: string,
        duration: string,
    },
    secondary_obscodes: EPWObserver[],
    data_flag_ephemeris: boolean
}

export interface EPWTargetData {
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
    observations: EPWObservation[],
}

export interface EPWData {
    items: { 
        // Key is planet ID
        [key: string]: EPWTargetData
    }[],
}
