function ProductFactory(enclave) {
    const Product = require("../models/Product.js");
    const ModelFactoryMixin = require("./ModelFactoryMixin.js");
    ModelFactoryMixin(this, enclave);

    this.getInstance = (domain, subdomain, gtin, version) => {
        return new Product(enclave, domain, subdomain, gtin, version);
    }

    this.createProduct = async (domain, subdomain, gtin, version) => {
        return await this.create(domain, subdomain, gtin, version);
    }

    this.lookupProduct = async function (domain, subdomain, gtin, version) {
        return await this.lookup(domain, subdomain, gtin, version);
    }

    this.checkObjectStatus = async function (domain, subdomain, gtin, version) {
        let productDummy = new Product(enclave, domain, subdomain, gtin, version);
        return await productDummy.checkStatus();
    }
}

let productFactory;

function getInstance(enclave) {
    if (!productFactory) {
        productFactory = new ProductFactory(enclave);
    }
    return productFactory;
}

module.exports = {
    getInstance
};
