const GTIN_SSI = require("../GTIN_SSI");

function getGTINOwner(server) {
  if(server.allowFixedUrl){
    //let's make the fixedURL middleware aware of our endpoints
    server.allowFixedUrl("/gtinOwner/");
  }

  const logger = $$.getLogger("gtinOwner", "getGtinOwner");
  server.get("/gtinOwner/:epiDomain/:gtin", async function (request, response) {
    let epiDomain = request.params.epiDomain;
    let gtin = request.params.gtin;

    const openDSU = require("opendsu");

    const gtinSSI = GTIN_SSI.createGTIN_SSI(epiDomain, undefined, gtin);
    const anchoring = openDSU.loadAPI("anchoring");
    const anchoringx = anchoring.getAnchoringX();
    anchoringx.getLastVersion(gtinSSI, (err, latestHashLink) => {
      if (err) {
        logger.info(0x103, `Failed to get last version for SSI <${gtinSSI.getIdentifier()}>`, err.message);
        sendResponse(response, 500, JSON.stringify({error: err}));
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
      sendResponse(response, 200, JSON.stringify({
        domain: latestHashLink.getDLDomain()
      }));
    })
  })
}

function sendResponse(response, statusCode, message) {
  response.statusCode = statusCode;
  response.end(message);
}

module.exports.getGTINOwner = getGTINOwner;
