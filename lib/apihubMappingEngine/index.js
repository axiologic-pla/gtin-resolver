const errUtils = require("../mappings/errors/errorUtils.js");
errUtils.addMappingError("TOKEN_VALIDATION_FAIL");
const errMap = require("opendsu").loadApi("m2dsu").getErrorsMap();
const customErr = errMap.newCustomError(errMap.errorTypes.TOKEN_VALIDATION_FAIL, "token");

function getEPIMappingEngineForAPIHUB(server) {

    //this middleware is not present in MVP1
    return;

    const gtinResolverBundle = "./../../../gtin-resolver/build/bundles/gtinResolver.js";
    require(gtinResolverBundle);
    const workerController = new WorkerController(server.rootFolder);
    workerController.boot((err) => {
        if (err) {
            console.log(err);
        }
    })

    function putMessage(request, response) {
        const apiHub = require("apihub");
        let domainName = request.params.domain;
        let subdomainName = request.params.subdomain;
        let walletSSI = request.headers.token;

        console.log(`EPI Mapping Engine called for domain:  ${domainName}, and walletSSI : ${walletSSI}`);

        let data = [];
        request.on('data', (chunk) => {
            data.push(chunk);
        });

        request.on('end', async () => {

            try {
                let body = Buffer.concat(data).toString();
                let messages = JSON.parse(body);
                if (!Array.isArray(messages)) {
                    messages = [messages]
                }
                let domainConfig = apiHub.getDomainConfig(domainName);
                let subdomain = domainConfig && domainConfig.bricksDomain ? domainConfig.bricksDomain : subdomainName;

                if (!subdomain) {
                    throw new Error(`Missing subdomain. Must be provided in url or set in configuration`);
                }

                /*if (!walletSSI) {
                  if (!domainConfig) {
                    throw new Error(`Domain configuration ${domain} not found`);
                  }

                  //token should be in request header or in domain configuration or in the message body
                  if (!domainConfig.mappingEngineWalletSSI) {
                    if (!messages[0].token) {
                      let err = new Error(`mappingEngineWalletSSI is not set in the domain with name ${domain} configuration and no token provided in header or message`);
                      err.debug_message = "Invalid credentials";
                      throw err;
                    } else {
                      walletSSI = messages[0].token
                    }

                  }
                }

                walletSSI = walletSSI || domainConfig.mappingEngineWalletSSI;
        */
                let {
                    walletGroupMap,
                    droppedMessages
                } = workerController.groupByWallet(messages, walletSSI, domainConfig, domainName, subdomain);
                try {
                    let groups = Object.keys(walletGroupMap);
                    if (groups.length === 0) {
                        let err = new Error(`token not set in body or header or in domain config`);
                        err.debug_message = "Invalid credentials";
                        throw err;
                    }
                    for (let i = 0; i < groups.length; i++) {
                        await workerController.addMessages(groups[i], domainName, subdomain, walletGroupMap[groups[i]], droppedMessages);
                    }

                } catch (err) {
                    console.log(err);
                    err.debug_message === "Invalid credentials" ? response.statusCode = 403 : response.statusCode = 500;
                    response.write(err.message);
                    return response.end();
                }

                response.statusCode = 200;
                if (droppedMessages.length > 0) {
                    response.write(JSON.stringify({droppedMessages, reason: "Invalid or missing token"}));
                    let messagesToPersist = workerController.getResponseTemplates(droppedMessages);
                    let errInfo = customErr.otherErrors.details[0];
                    messagesToPersist.forEach(msg => {
                        msg.addErrorResponse(errInfo.errorType, errInfo.errorMessage, errInfo.errorDetails, errInfo.errorField);
                    })
                    await workerController.persistMessageResults(messagesToPersist);
                }
                response.end();
            } catch (err) {
                console.error("Error on parse request message", err);
                err.debug_message === "Invalid credentials" ? response.statusCode = 403 : response.statusCode = 500;
                response.write(err.message);
                response.end();
            }
        })

    }

    server.put("/mappingEngine/:domain", putMessage);
    server.put("/mappingEngine/:domain/:subdomain", putMessage);

}

function WorkerController(rootFolder) {
    //dependencies
    const gtinResolver = require("gtin-resolver");
    const openDSU = require("opendsu");
    const getBaseUrl = openDSU.loadApi("system").getBaseURL;
    const path = require("path");
    const fs = require("fs");
    const createLokiEnclaveFacadeInstance = require("loki-enclave-facade").createLokiEnclaveFacadeInstance;

    //constants
    const MAX_NUMBER_OF_MESSAGES = 50;
    const MAX_GROUP_SIZE = 10;
    const GROUPING_TIMEOUT = 5 * 1000;
    const ENCLAVE_FOLDER = path.join(rootFolder, "external-volume", "enclaves");
    const DATABASE_PERSISTENCE_TIMEOUT = 100;

    //state variables
    const walletIsBeingProcessed = {};
    const messagesPipe = {};
    const databases = {};
    const getDatabase = (walletSSI) => {
        if (typeof databases[walletSSI] === "undefined") {
            databases[walletSSI] = createLokiEnclaveFacadeInstance(path.join(ENCLAVE_FOLDER, walletSSI), DATABASE_PERSISTENCE_TIMEOUT);
        }
        return databases[walletSSI];
    }

    function getMessageEndPoint(message) {
        const apiHub = require("apihub");
        let {domain, subdomain} = message.context;
        let domainConfig = apiHub.getDomainConfig(domain);

        let mappingEnginResultURL = domainConfig.mappingEnginResultURL || `${getBaseUrl()}/mappingEngine/${domain}/${subdomain}/saveResult`;
        if (message.senderId && domainConfig.mappingEnginResultURLs && Array.isArray(domainConfig.mappingEnginResultURLs)) {
            let endpointObj = domainConfig.mappingEnginResultURLs.find(item => item["endPointId"] === message.senderId);
            if (endpointObj) {
                mappingEnginResultURL = endpointObj.endPointURL;
            }
        }

        return mappingEnginResultURL;
    }

    this.getResponseTemplates = (messages) => {
        const gtinResolver = require("gtin-resolver");
        const mappings = gtinResolver.loadApi("mappings");
        return messages.map(msg => {
            let response = mappings.buildResponse(0.2);
            response.setReceiverId(msg.senderId);
            response.setSenderId(msg.receiverId);
            response.setMessageType(msg.messageType);
            response.setRequestData(msg);
            response.endPoint = getMessageEndPoint(msg);
            return response;
        });
    }

    this.persistMessageResults = async (messagesToPersist) => {
        const httpSpace = require("opendsu").loadApi('http');
        for (let item of messagesToPersist) {
            try {
                await $$.promisify(httpSpace.doPut)(item.endPoint, JSON.stringify(item));
            } catch (err) {
                console.log(`Could not persist message: ${item} with error ${err}`);
            }
        }
    }
    let self = this;

    async function logUndigestedMessages(groupMessages, walletSSI, response) {
        let undigestedMessages = response.undigestedMessages;
        let messagesToPersist = self.getResponseTemplates(groupMessages);
        const gtinResolver = require("gtin-resolver");
        const mappings = gtinResolver.loadApi("mappings");
        let LogService = gtinResolver.loadApi("services").LogService;
        let logService = new LogService();
        let sharedEnclave = await getSharedEnclaveForWallet(walletSSI);
        let mappingLogService = mappings.getMappingLogsInstance(sharedEnclave, logService);
        try {
            for (let i = 0; i < messagesToPersist.length; i++) {
                let itemToPersist = messagesToPersist[i];
                let index = undigestedMessages.findIndex(uMsg => {
                    if (typeof uMsg === "string") {
                        uMsg = JSON.parse(uMsg);
                    }
                    return uMsg.message.messageId === itemToPersist.requestMessageId;
                })

                if (index >= 0) {
                    let undigestedMessage = undigestedMessages[index];
                    let errorStatus = undigestedMessage.error.debug_message || null;
                    if (undigestedMessage.error && undigestedMessage.error.otherErrors && undigestedMessage.error.otherErrors.details.length) {
                        mappingLogService.logFailAction(undigestedMessage.message, undigestedMessage.error.otherErrors.details, errorStatus)
                        undigestedMessage.error.otherErrors.details.forEach((element) => {
                            itemToPersist.addErrorResponse(element.errorType, element.errorMessage, element.errorDetails, element.errorField);
                        })
                    } else {
                        mappingLogService.logFailAction(undigestedMessage.message, undigestedMessage.error, errorStatus)
                    }
                }
            }

        } catch (e) {
            console.log(e);
        }
        await self.persistMessageResults(messagesToPersist);
    }

    const getMessagePipe = (walletSSI) => {
        if (typeof messagesPipe[walletSSI] === "undefined") {
            const MessagesPipe = gtinResolver.getMessagesPipe();
            const MessageQueuingService = gtinResolver.loadApi("services").getMessageQueuingServiceInstance();
            messagesPipe[walletSSI] = new MessagesPipe(MAX_GROUP_SIZE, GROUPING_TIMEOUT, MessageQueuingService.getNextMessagesBlock);
        }

        return messagesPipe[walletSSI];
    }

    const getMessagesFromDb = (walletSSI, callback) => {
        const db = getDatabase(walletSSI);
        db.listQueue("", walletSSI, "asc", MAX_NUMBER_OF_MESSAGES, async (err, dbMessages) => {
            if (err) {
                return callback(err);
            }

            if (!dbMessages || dbMessages.length === 0) {
                return callback(undefined, []);
            }
            let messages = [];
            for (let i = 0; i < dbMessages.length; i++) {
                const message = await $$.promisify(db.getObjectFromQueue)("", walletSSI, dbMessages[i]);
                messages.push(message);
            }

            callback(undefined, messages);
        });
    }

    const deleteProcessedMessagesFromDb = async (walletSSI, messages) => {
        const db = getDatabase(walletSSI);
        for (let i = 0; i < messages.length; i++) {
            await $$.promisify(db.deleteObjectFromQueue)("", walletSSI, messages[i].pk)
        }
    };

    const dispatchMessagesToWorker = async (walletSSI, messages) => {
        const syndicate = require("syndicate");
        const pool = syndicate.createWorkerPool({
            bootScript: require("path").join(__dirname, "./threadBootscript.js")
        })

        const task = {
            walletSSI,
            messages,
        }

        walletIsBeingProcessed[walletSSI] = true;
        let response = await $$.promisify(pool.addTask, pool)(JSON.stringify(task));
        response = JSON.parse(response);
        walletIsBeingProcessed[walletSSI] = false;
        return response;
    }

    const processWalletMessages = (walletSSI, callback) => {
        if (walletIsBeingProcessed[walletSSI]) {
            return callback();
        }

        getMessagesFromDb(walletSSI, async (err, messages) => {
            if (err) {
                return callback(err);
            }

            if (messages.length === 0) {
                return callback();
            }

            const messagePipe = getMessagePipe(walletSSI);
            messagePipe.addInQueue(messages);
            let noGroupMessages = 0;
            messagePipe.onNewGroup(async (groupMessages) => {
                noGroupMessages += groupMessages.length;
                try {
                    const response = await dispatchMessagesToWorker(walletSSI, groupMessages);
                    await deleteProcessedMessagesFromDb(walletSSI, groupMessages);
                    await logUndigestedMessages(groupMessages, walletSSI, response);
                } catch (e) {
                    return callback(e);
                }

                if (noGroupMessages === messages.length) {
                    processWalletMessages(walletSSI, callback);
                }
            })
        })
    }

    async function getSharedEnclaveForWallet(walletSSI) {
        const resolver = require("opendsu").loadAPI("resolver");
        let wallet = await $$.promisify(resolver.loadDSU)(walletSSI);
        const scAPI = openDSU.loadApi("sc");
        scAPI.setMainDSU(wallet);
        let sharedEnclave = await $$.promisify(scAPI.getSharedEnclave)();
        return sharedEnclave;
    }

    this.boot = (callback) => {
        const __processWallets = () => {
            fs.readdir(ENCLAVE_FOLDER, async (err, files) => {
                if (err) {
                    return callback(err);
                }

                if (files.length === 0) {
                    return callback();
                }

                for (let i = 0; i < files.length; i++) {
                    const walletSSI = files[i];
                    await $$.promisify(processWalletMessages)(walletSSI);
                }
                callback();
            })
        }

        fs.access(ENCLAVE_FOLDER, async err => {
            if (err) {
                fs.mkdir(ENCLAVE_FOLDER, {recursive: true}, async err => {
                    if (err) {
                        return callback(err);
                    }

                    __processWallets();
                });

                return
            }

            __processWallets();
        })
    }

    let addMessageToMap = (walletGroupMap, message, token) => {
        if (!walletGroupMap[token]) {
            walletGroupMap[token] = [];
        }
        walletGroupMap[token].push(message)
    }

    this.groupByWallet = (messages, headerToken, domainConfig, domain, subdomain) => {
        let walletGroupMap = {};
        let droppedMessages = []
        messages.forEach(message => {
            if (message.token) {
                addMessageToMap(walletGroupMap, message, message.token)
            } else if (headerToken) {
                addMessageToMap(walletGroupMap, message, headerToken)
            } else if (domainConfig && domainConfig.mappingEngineWalletSSI) {
                addMessageToMap(walletGroupMap, message, domainConfig.mappingEngineWalletSSI)
            } else {
                message.context = {
                    domain,
                    subdomain
                };
                droppedMessages.push(message)
            }
        })
        return {walletGroupMap, droppedMessages}
    }

    this.addMessages = async (walletSSI, domain, subdomain, messages, droppedMessages) => {
        try {
            const resolver = require("opendsu").loadAPI("resolver");
            await $$.promisify(resolver.loadDSU)(walletSSI);
        } catch (e) {
            droppedMessages.push(messages)
            return;
        }

        const db = getDatabase(walletSSI);

        for (let i = 0; i < messages.length; i++) {
            let message = messages[i];
            message.context = {
                domain,
                subdomain
            };
            await $$.promisify(db.addInQueue)("", walletSSI, message);
        }

        $$.promisify(processWalletMessages)(walletSSI);
    }
}

module.exports.getEPIMappingEngineForAPIHUB = getEPIMappingEngineForAPIHUB;
