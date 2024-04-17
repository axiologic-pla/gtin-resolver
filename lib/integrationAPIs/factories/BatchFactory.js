function BatchFactory(enclave) {
    const Batch = require("../models/Batch.js");
    const ModelFactoryMixin = require("./ModelFactoryMixin.js");
    ModelFactoryMixin(this, enclave);

    this.getInstance = (domain, subdomain, gtin, version, batchNumber) => {
        return new Batch(enclave, domain, subdomain, gtin, batchNumber, version);
    }
    this.createBatch = async (domain, subdomain, gtin, batchNumber, version) => {
        return await this.create(domain, subdomain, gtin, version, batchNumber);
    }

    this.lookupBatch = async (domain, subdomain, gtin, batchNumber, version) => {
        return await this.lookup(domain, subdomain, gtin, version, batchNumber);
    }

    this.checkObjectStatus = async function (domain, subdomain, gtin, batchNumber, version) {
        let batchDummy = new Batch(enclave, domain, subdomain, gtin, batchNumber, version);
        return await batchDummy.checkStatus();
    }
}

let batchFactory;

function getInstance(enclave) {
    if (!batchFactory) {
        batchFactory = new BatchFactory(enclave);
    }
    return batchFactory;
}

module.exports = {
    getInstance
};
