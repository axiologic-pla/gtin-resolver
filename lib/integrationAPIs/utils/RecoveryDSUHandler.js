let args = process.argv.slice(2);
let version = args[0];
let gtin = args[1];
let batchNumber = args[2];

let domain = process.env.EPI_DOMAIN;
let subdomain = process.env.EPI_SUBDOMAIN;

require("../../../../opendsu-sdk/builds/output/pskWebServer.js");

const LightDBEnclaveFactory = require("../utils/LightDBEnclaveFactory.js");
const lightDBEnclaveFactory = LightDBEnclaveFactory.getLightDBEnclaveFactoryInstance();

async function run() {
    const enclaveInstance = await lightDBEnclaveFactory.createLightDBEnclaveAsync(domain, subdomain);
    let factory;
    let args = [domain, subdomain, gtin, version];
    if (typeof batchNumber !== "undefined") {
        factory = require("../factories/BatchFactory.js").getInstance(enclaveInstance);
        args.push(batchNumber);
    } else {
        factory = require("../factories/ProductFactory.js").getInstance(enclaveInstance);
    }

    let target = factory.getInstance(...args);
    let newVersion = await target.recover();

    process.send({version: newVersion}, () => {
        setTimeout(() => {
            process.exit(0);
        }, 0);
    });
}

run();