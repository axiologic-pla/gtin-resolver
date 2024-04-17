let types = [
    {name: "Leaflet", code: "leaflet", disabled: false, selected: false},
    {name: "SMPC", code: "smpc", disabled: false, selected: false}
];

module.exports = {
    getList() {
        return types;
    },
    getListAsVM(disabledFeatures) {
        let result = [];
        result.push({label: "Select a type", value: "", disabled: true, selected: false});
        if (disabledFeatures && disabledFeatures.length > 0) {
            disabledFeatures.forEach(feature => {
                types = types.map(item => {
                    if (item.code === feature) {
                        item.disabled = true;
                    }
                    return item;
                })
            })
        }
        types.forEach(type => {
            result.push({label: type.name, value: type.code, disabled: type.disabled, selected: type.selected});
        });

        let index = result.findIndex(item => item.disabled === false);
        if (index >= 0) {
            result[index].selected = true;
        }

        return result;
    },
    getLanguage(code) {
        return types.find(language => language.code === code).name;
    }
}
