const openDSU = require("opendsu");
const config = openDSU.loadAPI("config");

async function getDisabledFeatures() {
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

async function isFeatureEnabledAsync(feature) {
    let disabledFeatures = await getDisabledFeatures();
    if (disabledFeatures.indexOf(feature) !== -1) {
        return false;
    }
    return true;
}

function isFeatureEnabled(feature, callback) {
    isFeatureEnabledAsync(feature).then((enabled) => {
        return callback(undefined, enabled);
    }).catch(() => {
        callback(undefined, true);
    });
}

module.exports = {
    getDisabledFeatures,
    isFeatureEnabled,
    isFeatureEnabledAsync
}
