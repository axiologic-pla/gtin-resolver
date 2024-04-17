//loading EPI necessary mappings
require("./product/product.js");
require("./batch/batch.js");
require("./product/productPhoto.js");
require("./product-video/videoSource.js");
require("./leaflet/leaflet.js");
require("./leaflet/leafletDelete.js");

module.exports.getEPIMappingEngine = function (options, callback) {
    if (typeof options === "function") {
        callback = options;
        options = undefined;
    }
    const openDSU = require("opendsu");
    const scAPI = openDSU.loadAPI("sc");
    scAPI.getSharedEnclave((err, sharedEnclave) => {
        if (err) {
            return callback(err);
        }
        const mappingEngine = openDSU.loadApi("m2dsu").getMappingEngine(sharedEnclave, options);
        callback(undefined, mappingEngine);
    })
}

// module.exports.utils = require("./utils.js");
module.exports.getMappingLogs = function (storageService) {
    return require("../utils/LogUtils").createInstance(storageService).getMappingLogs;
}
module.exports.getMappingLogsInstance = function (storageService, logService) {
    return require("../utils/LogUtils").createInstance(storageService, logService);
}

module.exports.buildResponse = function (version) {
    return require("./responses").buildResponse(version);
}
