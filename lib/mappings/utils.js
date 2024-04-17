const constants = require("../constants/constants");
const SmartUrl = require("opendsu").loadApi("utils").SmartUrl;

function buildLeafletUrl(domain, leaflet_type, gtin, language, batchNumber) {
    //query params are sort on the fixedURL middleware when checking for any entry....
    //so we need to create the url that will be "hashed" with base64 into the same order and thus why
    //we will use URLSearchParams.sort function will provide the same sort mechanism on client and server
    let converter = new URL("https://non.relevant.url.com");
    //let create a wrapper over append method to ensure that no undefined variable will be added to the query
    let append = converter.searchParams.append;
    converter.searchParams.append = (name, value) => {
        if (typeof value === "undefined") {
            return;
        }
        append.call(converter.searchParams, name, value);
    }

    converter.searchParams.append("batch", batchNumber);
    converter.searchParams.append("lang", language);
    converter.searchParams.append("gtin", gtin);
    converter.searchParams.append("leaflet_type", leaflet_type);
    converter.searchParams.sort();
    return `/leaflets/${domain}?${converter.searchParams.toString()}`;
}

function buildGtinOwnerURL(domain, gtin) {
    return `/gtinOwner/${domain}/${gtin}`;
}

function getReplicasAsSmartUrls(targetDomain, callback) {
    const BDNS = require("opendsu").loadApi("bdns");
    BDNS.getAnchoringServices(targetDomain, (err, endpoints) => {
        if (err) {
            return callback(err);
        }
        let replicas = [];
        for (let endpoint of endpoints) {
            replicas.push(new SmartUrl(endpoint));
        }
        return callback(undefined, replicas);
    });
}

function call(endpoints, body, callback) {
    function executeRequest() {
        if (endpoints.length === 0) {
            const msg = `Not able to activate fixedUrl`;
            console.log(msg);
            return callback(new Error(msg));
        }

        let apihubEndpoint = endpoints.shift();
        apihubEndpoint.doPut(body, {}, (err) => {
            if (err) {
                console.error(err);
                //if we get error we try to make a call to other endpoint if any
                executeRequest();
            } else {
                return callback(undefined, true);
            }
        });
    }

    executeRequest();
}

function registerGtinOwnerFixedUrlByDomain(domain, gtin, callback) {
    getReplicasAsSmartUrls(domain, (err, replicas) => {
        if (replicas.length === 0) {
            const msg = `Not able to fix the url for gtinOwner`;
            console.log(msg);
            return callback(new Error(msg));
        }

        let body = JSON.stringify([buildGtinOwnerURL(domain, gtin)]);

        let targets = [];
        for (let replica of replicas) {
            targets.push(replica.concatWith("/registerFixedURLs"));
        }

        call(targets, body, callback);
    });
}

function registerLeafletFixedUrlByDomain(domain, subdomain, leaflet_type, gtin, language, batchNumber, expiry, epiVersion, callback) {
    getReplicasAsSmartUrls(subdomain, (err, replicas) => {
        if (replicas.length === 0) {
            const msg = `Not able to fix the url for Leaflet`;
            console.log(msg);
            return callback(new Error(msg));
        }

        let body;
        if (Array.isArray(language)) {
            let urls = [];
            for (let lang of language) {
                urls.push(buildLeafletUrl(domain, leaflet_type, gtin, lang, batchNumber, expiry, epiVersion));
            }
            body = JSON.stringify(urls);
        } else {
            body = JSON.stringify([buildLeafletUrl(domain, leaflet_type, gtin, language, batchNumber, expiry, epiVersion)]);
        }

        let targets = [];
        for (let replica of replicas) {
            targets.push(replica.concatWith("/registerFixedURLs"));
        }

        call(targets, body, callback);
    });
}

function getActivateRelatedFixedURLHandler(getReplicasFnc) {
    return function activateRelatedFixedUrl(dsu, domain, gtin, callback) {
        if (typeof callback === "undefined") {
            callback = (err) => {
                if (err) {
                    console.error(err);
                }
            }
        }

        let next = async () => {
            //we were able to commit the new changes then we should call the fixedUrl endpoints
            getReplicasFnc(domain, function (err, replicas) {
                if (replicas.length === 0) {
                    const msg = `Not able to activate fixedUrls`;
                    console.log(msg);
                    return callback(new Error(msg));
                }
                let targets = [];
                for (let replica of replicas) {
                    targets.push(replica.concatWith("/activateFixedURL"));
                }

                call(targets, `url like (${gtin})`, callback);
            });
        }

        if (dsu) {
            dsu.onCommitBatch(next, true);
        } else {
            next();
        }
    }
}

function getDeactivateRelatedFixedURLHandler(getReplicasFnc) {
    return function deactivateRelatedFixedUrl(dsu, domain, gtin, callback) {
        getReplicasFnc(domain, function (err, replicas) {
            if (replicas.length === 0) {
                const msg = `Not able to deactivate fixedUrls`;
                console.log(msg);
                return callback(new Error(msg));
            }
            let targets = [];
            for (let replica of replicas) {
                targets.push(replica.concatWith("/deactivateFixedURL"));
            }

            call(targets, `url like (${gtin})`, callback);
        });
    }
}

function getProductJSONIndication(message) {
    return {product: `${constants.PRODUCT_STORAGE_FILE}${message.messageTypeVersion}`};
}

function getBatchJSONIndication(message) {
    return {batch: `${constants.BATCH_STORAGE_FILE}${message.messageTypeVersion}`}
}

let expose = {
    getProductJSONIndication,
    getBatchJSONIndication,
    registerLeafletFixedUrlByDomain,
    registerGtinOwnerFixedUrlByDomain,
    activateLeafletFixedUrl: getActivateRelatedFixedURLHandler(getReplicasAsSmartUrls),
    deactivateLeafletFixedUrl: getDeactivateRelatedFixedURLHandler(getReplicasAsSmartUrls),
    activateGtinOwnerFixedUrl: getActivateRelatedFixedURLHandler(getReplicasAsSmartUrls),
    deactivateGtinOwnerFixedUrl: getDeactivateRelatedFixedURLHandler(getReplicasAsSmartUrls)
}

expose.registerLeafletFixedUrlByDomainAsync = $$.promisify(expose.registerLeafletFixedUrlByDomain);
expose.registerGtinOwnerFixedUrlByDomainAsync = $$.promisify(expose.registerGtinOwnerFixedUrlByDomain);
expose.deactivateLeafletFixedUrlAsync = $$.promisify(expose.deactivateLeafletFixedUrl);
expose.deactivateGtinOwnerFixedUrlAsync = $$.promisify(expose.deactivateGtinOwnerFixedUrl);

module.exports = expose;
