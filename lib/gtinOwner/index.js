const GTIN_SSI = require("../GTIN_SSI");
const path = require("path");
const fs = require('fs');
const CACHE_FILE = "gtinOwners";

function getGTINOwner(server) {
    if (server.allowFixedUrl) {
        //let's make the fixedURL middleware aware of our endpoints
        server.allowFixedUrl("/gtinOwner/");
    }

    const logger = $$.getLogger("gtinOwner", "getGtinOwner");
    const lokiEnclaveFacadeModule = require("loki-enclave-facade");
    const createLokiEnclaveFacadeInstance = lokiEnclaveFacadeModule.createLokiEnclaveFacadeInstance;
    const cachePath = path.join(server.rootFolder, "external-volume", "gtinOwner", "cache");

    const DATABASE_PERSISTENCE_TIMEOUT = 100;
    let database;

    if (!server.readOnlyModeActive) {
        try {
            fs.accessSync(cachePath);
        } catch (e) {
            fs.mkdirSync(cachePath, {recursive: true});
        }
        database = createLokiEnclaveFacadeInstance(path.join(cachePath, CACHE_FILE), DATABASE_PERSISTENCE_TIMEOUT, lokiEnclaveFacadeModule.Adaptors.FS);
    }

    const GTIN_OWNERS_TABLE = "gtinOwners";

    async function getGtinOwnerHandler(request, response) {
        let epiDomain = request.params.epiDomain;
        let gtin = request.params.gtin;
        const url = `/gtinOwner/${epiDomain}/${gtin}`;
        let gtinOwnerDomain;
        try {
            if (database) {
                gtinOwnerDomain = await $$.promisify(database.getRecord)(undefined, GTIN_OWNERS_TABLE, url);
            }
        } catch (e) {
            //exceptions on getting records from db are handled bellow
        }
        if (typeof gtinOwnerDomain !== "undefined") {

            try {
                let dbObj = JSON.parse(gtinOwnerDomain);
                if (dbObj.domain) {
                    return sendResponse(response, 200, gtinOwnerDomain);
                }
            } catch (e) {
                //db record is invalid; continue with resolving request
            }

        }
        const openDSU = require("opendsu");

        const gtinSSI = GTIN_SSI.createGTIN_SSI(epiDomain, undefined, gtin);
        const anchoring = openDSU.loadAPI("anchoring");
        const anchoringx = anchoring.getAnchoringX();
        anchoringx.getLastVersion(gtinSSI, async (err, latestHashLink) => {
            if (err) {
                logger.info(0x103, `Failed to get last version for SSI <${gtinSSI.getIdentifier()}>`, err.message);
                sendResponse(response, 500, JSON.stringify({error: err}));
                return;
            }

            if (!latestHashLink) {
                logger.info(0x103, `Gtin not found`);
                sendResponse(response, 404, "");
                return;
            }

            const keySSISpace = require("opendsu").loadAPI("keyssi");
            if (typeof latestHashLink === "string") {
                try {
                    latestHashLink = keySSISpace.parse(latestHashLink);
                } catch (e) {
                    logger.info(0x103, `Failed to parse hashlink <${latestHashLink}>`, e.message);
                    sendResponse(response, 500, JSON.stringify({error: e}))
                    return;
                }
            }

            gtinOwnerDomain = JSON.stringify({
                domain: latestHashLink.getDLDomain(),
            });

            if (!server.readOnlyModeActive) {
                try {
                    await $$.promisify(database.insertRecord)(undefined, GTIN_OWNERS_TABLE, url, gtinOwnerDomain);
                } catch (e) {
                    logger.info(0x0, `Failed to cache gtinOwnerDomain `, e.message);
                    //failed to cache; continue without caching
                }
            }

            sendResponse(response, 200, gtinOwnerDomain);
        })
    }

    server.get("/gtinOwner/:epiDomain/:gtin", getGtinOwnerHandler);
    server.get("/gtinOwner/:epiDomain/:gtin/:subdomain", function (req, res) {
        let url = req.url.replace(`/${req.params.subdomain}`, "");
        logger.debug("Local resolving of gtinOwner without the extra params");
        return server.makeLocalRequest("GET", url, (err, content) => {
            if (err) {
                logger.error(0x100, err.message);
                return sendResponse(res, 529, `Server busy finding gtinOwner`);
            }
            logger.debug(0x100, "Successfully returned gtinOwner info after local redirect");
            return sendResponse(res, 200, content);
        });
    });
}

function sendResponse(response, statusCode, message) {
    response.statusCode = statusCode;
    response.end(message);
}

module.exports.getGTINOwner = getGTINOwner;
