const openDSU = require('opendsu');
const crypto = openDSU.loadAPI('crypto');
const makeRequest = (url, method = 'GET', headers = {}) => {
    return new Promise((resolve, reject) => {
        const options = {
            method,
            headers
        };

        const req = https.request(new URL(url), options, (res) => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({statusCode: res.statusCode, body: JSON.parse(data)});
                } else {
                    reject({statusCode: res.statusCode, body: data});
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.end();
    });
};
const generatePk = () => {
    return Array.from(crypto.generateRandom(32))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

module.exports = {
    makeRequest,
    generatePk
};
