const openDSU = require("opendsu");
const config = openDSU.loadAPI("config");

async function getLeafletDisabledFeatures() {
    let disabledFeaturesArr = [];
    try {
        let disabledFeaturesList = await $$.promisify(config.getEnv)("disabledFeatures");
        if (disabledFeaturesList) {
            let disabledCodesArr = disabledFeaturesList.split(",");
            disabledCodesArr.forEach(item => {
                disabledFeaturesArr.push(item.trim());
            })
        }
    } catch (e) {
        console.log("Couldn't load disabledFeatures")
    }
    return disabledFeaturesArr;
}

async function getEpiProtocolVersion() {
    let defaultVersion = "1";
    let epiProtocolVersion = await $$.promisify(config.getEnv)("epiProtocolVersion");
    if (epiProtocolVersion && epiProtocolVersion !== "undefined") {
        return epiProtocolVersion
    }
    return defaultVersion;
}

module.exports = {
    getLeafletDisabledFeatures,
    getEpiProtocolVersion
}
