const XMLDisplayService = require("../services/XMLDisplayService/XMLDisplayService");
const GTIN_SSI = require("../GTIN_SSI");

function ApiCache(expirationTime) {
    let cache = {};
    this.registerResult = function (uid, apiName, result) {
        cache[uid + apiName] = {result, time: Date.now()};
    }

    this.getResult = function (uid, apiName) {
        let potentialResult = cache[uid + apiName];
        if (!potentialResult) {
            return;
        }
        if (Date.now() - expirationTime < potentialResult.time) {
            return potentialResult.result;
        }
        delete cache[uid + apiName];
        return;
    }
}

let apiCache = new ApiCache(10 * 1000);

module.exports.getLanguagesForProductAsync = async function (domain, gtin) {
    let apiName = "getLanguagesForProductAsync";
    let constSSI = GTIN_SSI.createGTIN_SSI(domain, undefined, gtin);
    let uid = constSSI.getIdentifier();
    let result = apiCache.getResult(uid, apiName);
    if (result) {
        return result;
    }
    const model = {
        product: {gtin},
        networkName: domain
    }
    let leafletXmlService = new XMLDisplayService(null, constSSI, model, "leaflet");
    result = await $$.promisify(leafletXmlService.getAvailableLanguagesFromPath, leafletXmlService)(constSSI, leafletXmlService.getProductPathToXmlType());
    apiCache.registerResult(uid, apiName, result);
    return result;
}

module.exports.getLanguagesForBatchAsync = async function (domain, gtin, batch) {
    let apiName = "getLanguagesForBatchAsync";
    let constSSI = GTIN_SSI.createGTIN_SSI(domain, undefined, gtin, batch);
    let uid = constSSI.getIdentifier();
    let result = apiCache.getResult(uid, apiName);
    if (result) {
        return result;
    }
    const model = {
        product: {gtin},
        networkName: domain
    }
    let leafletXmlService = new XMLDisplayService(null, constSSI, model, "leaflet");
    result = await $$.promisify(leafletXmlService.getAvailableLanguagesFromPath, leafletXmlService)(constSSI, leafletXmlService.getBatchPathToXmlType());
    apiCache.registerResult(uid, apiName, result);
    return result;
}

module.exports.checkDSUExistAsync = async function (constSSI) {
    let apiName = "checkDSUExist";
    let uid = constSSI.getIdentifier();
    let result = apiCache.getResult(uid, apiName);
    if (result) {
        return result;
    }
    const resolver = require("opendsu").loadApi("resolver");
    result = await $$.promisify(resolver.dsuExists)(constSSI);
    apiCache.registerResult(uid, apiName, result);
    return result;
}

module.exports.getAvailableLanguagesForType = function (constSSI, gtin, type, callback) {
    let apiName = "getAvailableLanguagesForType" + type;
    let uid = constSSI.getIdentifier();
    let result = apiCache.getResult(uid, apiName);
    if (result) {
        return callback(undefined, result);
    }

    const model = {
        product: {gtin},
        networkName: constSSI.getDLDomain()
    }
    let leafletXmlService = new XMLDisplayService(null, constSSI, model, type);

    leafletXmlService.getAvailableLanguagesForXmlType((langerr, availableLanguages) => {
        if (langerr) {
            return callback;
        }
        apiCache.registerResult(uid, apiName, availableLanguages);
        return callback(undefined, availableLanguages);
    });
}

module.exports.dsuExists = function (server, keySSI, gtin, useFastRoute = false, callback) {
    if (typeof useFastRoute === "function") {
        callback = useFastRoute;
        useFastRoute = false;
    }

    function resolverCheckDSU() {
        const resolver = require("opendsu").loadApi("resolver");
        resolver.dsuExists(keySSI, callback);
    }

    if (useFastRoute) {
        return server.makeLocalRequest("GET", `/gtinOwner/${keySSI.getDLDomain()}/${gtin}`, "", (err, response) => {
            if (err || !response.domain) {
                if (!err.cause) {
                    //network error
                }
                return resolverCheckDSU();
            }

            return callback(undefined, true);
        });
    }

    resolverCheckDSU();
}

module.exports.dsuExistsAsync = $$.promisify(module.exports.dsuExists);