const fs = require('fs');
const path = require('path');
const constants = require("../constants/constants");
const MESSAGE_SEPARATOR = "#$%/N";

function getEPIMappingEngineMessageResults(server) {
    const MESSAGES_PATH = path.join(server.rootFolder, "external-volume", "messages")

    function getLogs(msgParam, domain, callback) {
        const LOGS_FOLDER = path.join(MESSAGES_PATH, domain);
        const LOGS_FILE = path.join(LOGS_FOLDER, constants.LOGS_TABLE);
        fs.access(LOGS_FILE, fs.F_OK, (err) => {
            if (err) {
                return callback(`No logs found for domain -  ${domain}`);
            }

            fs.readFile(LOGS_FILE, 'utf8', (err, result) => {
                if (err) {
                    return callback(err);
                }
                let messages = result.split(MESSAGE_SEPARATOR)
                if (messages[messages.length - 1] === "") {
                    messages.pop();
                }
                messages = messages.map(msg => {
                    return JSON.parse(msg)
                });
                return callback(null, messages.reverse());
            })

        })

    }

    server.put("/mappingEngine/:domain/:subdomain/saveResult", function (request, response) {
        let msgDomain = request.params.domain;
        let data = [];
        request.on('data', (chunk) => {
            data.push(chunk);
        });

        request.on('end', async () => {

            try {
                let body = Buffer.concat(data).toString();

                const fileDir = path.join(MESSAGES_PATH, msgDomain);
                const logsFile = path.join(fileDir, constants.LOGS_TABLE);
                if (!fs.existsSync(fileDir)) {
                    fs.mkdirSync(fileDir, {recursive: true});
                }

                fs.appendFile(logsFile, body + MESSAGE_SEPARATOR, (err) => {
                    if (err) {
                        throw err;
                    }
                    response.statusCode = 200
                    response.end();
                });

            } catch (e) {
                response.statusCode = 500;
                response.end();
            }
        });
    })

    server.get("/mappingEngine/:domain/logs", function (request, response) {

        let domainName = request.params.domain;
        let msgParam = request.params.messageParam;
        console.log(`EPI Mapping Engine get called for domain:  ${domainName}`);

        try {
            getLogs(msgParam, domainName, (err, logs) => {
                if (err) {
                    console.log(err);
                    response.statusCode = 500;
                    response.end(JSON.stringify({result: "Error", message: "No logs"}));
                    return;
                }
                if (!logs || logs.length === 0) {
                    logs = "Log list is empty";
                }
                response.statusCode = 200;
                response.end(JSON.stringify(logs));
            });

        } catch (err) {
            console.error(err);
            response.statusCode = 500;
            response.end(JSON.stringify({result: "Error", error: err}));
        }

    });
}

module.exports.getEPIMappingEngineMessageResults = getEPIMappingEngineMessageResults;
