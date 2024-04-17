function ModelFactoryMixin(target) {
    const constants = require("../utils/constants.js");
    const cacheAPI = require("opendsu").loadAPI("cache");
    const cache = cacheAPI.getWeakRefMemoryCache(constants.MODELS_CACHE_NAME);

    target.getInstance = () => {
        throw Error("getInstance method not implemented");
    }

    target.getCacheKey = (gtin, batchNumber) => {
        if (typeof batchNumber === "undefined") {
            return gtin;
        }
        return `${gtin}_${batchNumber}`;
    }

    target.create = async (domain, subdomain, gtin, version, batchNumber) => {
        const cacheKey = target.getCacheKey(gtin, batchNumber);
        const instance = cache.get(cacheKey);
        if (instance) {
            return instance;
        }
        const newInstance = target.getInstance(domain, subdomain, gtin, version, batchNumber);
        cache.put(cacheKey, newInstance);
        await newInstance.getEventRecorderInstance(newInstance.getGTINSSI());
        return newInstance;
    };

    target.lookup = async (domain, subdomain, gtin, version, batchNumber) => {
        const cacheKey = target.getCacheKey(gtin, batchNumber);
        let instance = cache.get(cacheKey);

        if (instance) {
            try {
                instance.version = await instance.getBlockchainDSUVersion();

            } catch (err) {
                //todo: handle error
            }
            return instance;
        }

        instance = target.getInstance(domain, subdomain, gtin, version, batchNumber);

        if (await instance.immutableDSUIsCorrupted()) {
            let error;
            if (batchNumber) {
                error = new Error(`Failed to load batch information for gtin: ${gtin} batch: ${batchNumber}}`);
            } else {
                error = new Error(`Failed to load product information for gtin: ${gtin}`);
            }

            error.rootCause = require("opendsu").constants.ERROR_ROOT_CAUSE.MISSING_DATA_ERROR;
            throw error;
        }
        try {
            await instance.loadMutableDSUInstance();
        } catch (e) {
            return undefined; //no instance found
        }
        await instance.loadMetadata();
        try {
            instance.version = await instance.getBlockchainDSUVersion();
        } catch (err) {
            //todo: handle error
            console.log(err);
        }
        await instance.getEventRecorderInstance();
        cache.put(cacheKey, instance);
        return instance;

    }

    return target;
}

module.exports = ModelFactoryMixin;