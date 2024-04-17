function runRecovery(version, gtin, batchNumber) {

    return new Promise((resolve, reject) => {
        const {fork} = require('node:child_process');
        const logger = $$.getLogger("RecoveryDSUHandler", "integrationsAPIs");

        let path = require("path");
        let scriptPath = path.resolve(path.join(__dirname, 'RecoveryDSUHandler.js'));
        let cmdArgs = [version, gtin];
        if (batchNumber) {
            cmdArgs.push(batchNumber);
        }
        const recoveryDSUHandler = fork(scriptPath, cmdArgs);

        recoveryDSUHandler.on('message', (message) => {
            resolve(message.version);
        });

        recoveryDSUHandler.on('error', (error) => {
            reject(error);
        });

        recoveryDSUHandler.on('close', (code) => {
            logger.info(`Recovery process for ${gtin} ${batchNumber ? ' batch ' + batchNumber : ''} exited with code ${code}`);
        });
    });
}

module.exports = {
    runRecovery
}
