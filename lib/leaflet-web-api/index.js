const XMLDisplayService = require("./../services/XMLDisplayService/XMLDisplayService");
const LeafletInfoService = require("./../services/LeafletInfoService");

function getWebLeaflet(server) {

    server.registerAccessControlAllowHeaders(["epiprotocolversion", "X-Merck-APIkey", "X-api-key"]);
    if (server.allowFixedUrl) {
        //let's make the fixedURL middleware aware of our endpoints
        server.allowFixedUrl("/leaflets/");
    }

    const logger = $$.getLogger("leaflet-web-api", "getWebLeaflet");

    async function getLeafletHandler(request, response) {

        let domainName = request.params.domain;
        let leaflet_type = request.query.leaflet_type || "";
        let gtin = request.query.gtin || null;
        let lang = request.query.lang || "";
        let batchNumber = request.query.batch || null;

        if (batchNumber && batchNumber === "undefined") {
            //todo: find a better way to validate the query params
            batchNumber = null;
        }

        try {
            if (!gtin) {
                logger.info(0x103, `Missing required parameter <gtin>`);
                return sendResponse(response, 400, JSON.stringify({code: "002"}));
            }

            if (gtin.length !== 14) {
                logger.info(0x103, `Validation failed for gtin.length: <gtin>`);
                return sendResponse(response, 400, JSON.stringify({code: "002"}));
            }

            let validationResult = require("../utils/ValidationUtils").validateGTIN(gtin);
            if (validationResult && !validationResult.isValid) {
                logger.info(0x103, `Validation failed for gtin: <gtin>`);
                return sendResponse(response, 400, JSON.stringify({code: "003"}));
            }

            if (!leaflet_type) {
                logger.info(0x103, `Missing required parameter <leaflet_type>`);
                return sendResponse(response, 400, "leaflet_type is a required parameter. Please check api documentation");
            }

            switch (leaflet_type) {
                case "smpc":
                case "leaflet":
                    //we know to resolve only smpc and leaflets
                    break;
                default:
                    logger.info(0x103, `Unknown leaflet type: <leaflet_type>`);
                    return sendResponse(response, 400, "Unknown leaflet type. Please check api documentation");
            }

            if (!lang) {
                logger.info(0x103, `Missing required parameter <lang>`);
                return sendResponse(response, 400, "lang is a required parameter. Please check api documentation");
            }

            try {
                require("./../utils/Languages").getLanguageFromCode(lang);
            } catch (err) {
                logger.info(0x103, `Unable to handle lang: <lang>`);
                return sendResponse(response, 400, "Unable to handle lang. Please check api documentation");
            }

            let knownParams = ["leaflet_type", "gtin", "lang", "batch", "fixedurlrequest"];
            let queryParams = Object.keys(request.query);
            for (let param of queryParams) {
                if (knownParams.indexOf(param) === -1) {
                    logger.debug(`Query contains invalid param `, param);
                    return server.makeLocalRequest("GET", `/leaflets/${domainName}?gtin=${gtin}&lang=${lang}&leaflet_type=${leaflet_type}&batch=${batchNumber}`, (err, content) => {
                        if (err) {
                            logger.error(0x100, "Error Object", err);
                            return sendResponse(response, 529, `Server busy reading gtin only leaflet`);
                        }
                        logger.debug(0x100, "Successfully returned content without invalid params");
                        return sendResponse(response, 200, content);
                    });
                }
            }

            const GTIN_SSI = require("../GTIN_SSI");
            const productGtinSSI = GTIN_SSI.createGTIN_SSI(domainName, undefined, gtin);
            const utils = require("./leafletUtils");
            let productKnown = false;
            try {
                productKnown = await utils.checkDSUExistAsync(productGtinSSI);
            } catch (err) {
                logger.info(0x103, `Unable to check Product DSU existence`);
                logger.error(err);
                return sendResponse(response, 529, "Server busy checking product existence");
            }

            if (!productKnown) {
                logger.info(0x103, `Gtin unknown`);
                return sendResponse(response, 400, JSON.stringify({code: "001"}));
            }

            let leafletInfo = await LeafletInfoService.init({gtin, batchNumber}, domainName);
            const model = {
                product: {gtin},
                networkName: domainName
            }
            let leafletXmlService = new XMLDisplayService(null, leafletInfo.gtinSSI, model, leaflet_type);

            let batchExists = false;
            let preventProductFallback = false;
            try {
                const batchGtinSSI = GTIN_SSI.createGTIN_SSI(domainName, undefined, gtin, batchNumber);
                batchExists = await utils.checkDSUExistAsync(batchGtinSSI);
                if (batchExists) {
                    let batchLanguages = await utils.getLanguagesForBatchAsync(domainName, gtin, batchNumber);
                    if (batchLanguages.indexOf(lang) !== -1) {
                        preventProductFallback = true;
                    } else {
                        let productLanguages = await utils.getLanguagesForProductAsync(domainName, gtin);
                        if (productLanguages.indexOf(lang) !== -1) {
                            preventProductFallback = false;
                        } else {
                            //if we get to this point, and we have some languages we need to skip the fallback and let the normal apis to do their stuff
                            if (batchLanguages.length) {
                                preventProductFallback = true;
                            }
                        }
                    }
                }
            } catch (err) {
                logger.info(0x103, `Unable to check Batch DSU existence`);
                logger.error(err);
                return sendResponse(response, 529, "Server busy checking batch existence");
            }

            if (!batchExists || (batchNumber && !preventProductFallback)) {
                let content;
                try {
                    content = await $$.promisify(server.makeLocalRequest, server)("GET", `/leaflets/${domainName}?gtin=${gtin}&lang=${lang}&leaflet_type=${leaflet_type}`);
                } catch (err) {
                    if (err.httpCode && err.httpCode === 404) {

                    } else {
                        logger.error(0x100, "Error message", err.message);
                        logger.error(0x100, "Error Object", err);
                        logger.error(0x100, "Error Stack", err.stack);
                        return sendResponse(response, 529, `Server busy reading gtin only leaflet`);
                    }
                }

                if (content) {
                    logger.info(0x100, "Successfully returned content from redirect to gtin only url");
                    return sendResponse(response, 200, content);
                }
            }

            leafletXmlService.readXmlFile(lang, async (err, xmlContent, pathBase, leafletImagesObj) => {
                if (err) {
                    if (err.statusCode === 504) {
                        logger.error(0x100, "Error Object", err);
                        return sendResponse(response, 529, "System busy; please try again later");
                    }
                    let errMessage = `No available XML for gtin=${gtin} language=${lang} leaflet type=${leaflet_type}`
                    if (batchNumber) {
                        errMessage = `${errMessage} batchNumber id=${batchNumber}`;
                    }

                    utils.getAvailableLanguagesForType(leafletInfo.gtinSSI, gtin, leaflet_type, (langerr, availableLanguages) => {
                        if (langerr) {
                            logger.error(langerr);
                            logger.info(0x103, errMessage);
                            return sendResponse(response, 529, "System busy; please try again later");
                        }

                        if (!availableLanguages || !availableLanguages.length) {
                            logger.info(0x100, "No leaflet uploaded");
                            return sendResponse(response, 404, JSON.stringify({code: "011"}));
                        }

                        logger.info(0x100, "Sending alternative languages");
                        return sendResponse(response, 200, JSON.stringify({
                            resultStatus: "no_xml_for_lang",
                            availableLanguages: availableLanguages
                        }));
                    });
                } else {
                    let productData = await leafletInfo.getProductClientModel();
                    try {
                        let batchData = await leafletInfo.getBatchClientModel();
                        productData.batchData = batchData;
                    } catch (e) {
                        // gtin only case
                        productData.batchData = null;
                    }
                    return sendResponse(response, 200, JSON.stringify({
                        resultStatus: "xml_found",
                        xmlContent,
                        leafletImages: leafletImagesObj,
                        productData
                    }));
                }
            }, lang)
        } catch (err) {
            logger.info(0x103, err.message);
            return sendResponse(response, 500, err.message);
        }
    }

    server.get("/leaflets/:domain", getLeafletHandler);
    server.get("/leaflets/:domain/:subdomain", function (req, res) {
        let url = req.url.replace(`/${req.params.subdomain}`, "");
        logger.debug("Local searching for Leaflet without the extra params");
        return server.makeLocalRequest("GET", url, (err, content) => {
            if (err) {
                logger.error(0x100, "Error Object", err);
                return sendResponse(res, 529, `Server busy reading leaflet`);
            }
            logger.debug(0x100, "Successfully returned content after local redirect");
            return sendResponse(res, 200, content);
        });
    });
}


function sendResponse(response, statusCode, message) {
    response.statusCode = statusCode;
    response.end(message);
}

module.exports.getWebLeaflet = getWebLeaflet;
