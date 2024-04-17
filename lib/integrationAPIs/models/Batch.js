const ModelBase = require("./ModelBase.js");
const GTIN_SSI = require("../../GTIN_SSI.js");
const constants = require("../../constants/constants.js");

function Batch(enclave, domain, subdomain, gtin, batchNumber, version) {
    let instance = new ModelBase(enclave, domain, subdomain, gtin);

    //all the data that needs to be serialized as JSON needs to be added to the instance as soon as possible
    instance.productCode = gtin;
    instance.batchNumber = batchNumber;
    //there is version specific paths and logic that may need to be carefully treated
    instance.epiProtocol = `v${version}`;

    instance.getJSONStoragePath = () => {
        return `/batch.epi_${instance.epiProtocol}`;
    }

    instance.getLeafletStoragePath = (language, type) => {
        let path = `/${type}`;
        if (language) {
            path += `/${language}`;
        }
        return path;
    }

    instance.getLeafletFilePath = (language, type) => {
        return `${instance.getLeafletStoragePath(language, type)}/${type}.xml`;
    }

    instance.getMutableMountingPoint = () => {
        return constants.BATCH_DSU_MOUNT_POINT;
    }

    instance.getPathOfPathSSI = () => {
        return {
            path: `0/${gtin}/${batchNumber}`,
            domain: subdomain
        };
    }

    instance.getGTINSSI = () => {
        return GTIN_SSI.createGTIN_SSI(domain, subdomain, instance.productCode, instance.batchNumber);
    }


    let persist = instance.persist;
    instance.persist = async (auditContext) => {
        let diffs = await persist.call(instance, auditContext);
        //we need to trigger this only at the creation of the batch...
        if (auditContext && auditContext.operation === "Created Batch") {
            let languages = require("./../../utils/Languages.js").getList();
            let langs = [];
            for (let lang of languages) {
                let {code} = lang;
                langs.push(code);
            }
            let fixedUrlUtils = require("./../../mappings/utils.js");
            await fixedUrlUtils.registerLeafletFixedUrlByDomainAsync(domain, subdomain, "leaflet", gtin, langs, instance.batchNumber, undefined, instance.epiProtocol);
        }

        try {
            //we don't wait for the request to be finalized because of the delays between fixedUrl and lightDB
            $$.promisify(require("../../mappings/utils").activateGtinOwnerFixedUrl)(undefined, domain, gtin);
            $$.promisify(require("../../mappings/utils").activateLeafletFixedUrl)(undefined, domain, gtin);
        } catch (err) {
            //ignore them for now...
        }

        return diffs;
    }

    const loadMetadata = instance.loadMetadata;
    instance.loadMetadata = async () => {
        await loadMetadata.call(instance);
        instance.batchNumber = instance.batchNumber || instance.batch;
        instance.inventedName = instance.inventedName || instance.productName;
        instance.nameMedicinalProduct = instance.nameMedicinalProduct || instance.productName;
        instance.productCode = instance.productCode || instance.gtin;
        instance.expiryDate = instance.expiryDate || instance.expiry;
    }

    return instance;
}

module.exports = Batch;
