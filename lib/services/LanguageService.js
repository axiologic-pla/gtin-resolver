const constants = require("../constants/constants");
const languageServiceUtils = require("../../utils/languageServiceUtils");

let workingLanguagesCache = [];


class LanguageService {
  constructor(dsuStorageInstance) {
    if (typeof dsuStorageInstance === "undefined") {
      throw Error("Provide a DSUStorage instance when creating a new Language Service");
    }

    this.DSUStorage = dsuStorageInstance;
  }

  getSystemLanguage() {
    const browserLanguage = navigator.language;
    const browserLanguageCode = browserLanguage.substring(0, 2);
    return languageServiceUtils.getLanguageAsItemForVMFromCode(browserLanguageCode);
  }

/*
  addWorkingLanguages(languages, callback) {
    if (!Array.isArray(languages)) {
      languages = [languages];
    }
    this.getWorkingLanguages((err, workingLanguages) => {
      if (err) {
        return callback(err);
      }
      workingLanguagesCache = workingLanguages;
      let normalizedLanguages;
      try {
        normalizedLanguages = languages.filter(language => !this.hasWorkingLanguage(language))
          .map(language => this.normalizeLanguage(language));
      } catch (e) {
        return callback(e);
      }
      workingLanguagesCache = workingLanguagesCache.concat(normalizedLanguages);
      this.overwriteWorkingLanguages(workingLanguagesCache, callback);
    });
  }
*/

  hasWorkingLanguage(language) {
    language = this.normalizeLanguage(language);
    let index = workingLanguagesCache.findIndex(lang => lang.value === language.value);
    if (index >= 0) {
      return true;
    }

    return false;
  }

  getWorkingLanguages(callback) {
    this.DSUStorage.getObject(constants.LANGUAGES_STORAGE_PATH, (err, languages) => {
      if (err || typeof languages === "undefined") {
        workingLanguagesCache.push(this.getSystemLanguage());
        return this.overwriteWorkingLanguages(workingLanguagesCache, (err => callback(err, workingLanguagesCache)));
      }

      workingLanguagesCache = languages;
      callback(undefined, languages);
    });

  }

  getWorkingLanguagesListForSelect(callback) {
    this.getWorkingLanguages((err) => {
      if (err) {
        return callback(err);
      }
      callback(undefined, this.getLanguagesForSelect());
    });
  }

  getLanguagesForSelect(languages, callback) {
    languages = this.normalizeLanguages(languages);
    this.getWorkingLanguages((err, workingLanguages) => {
      if (err) {
        return callback(err);
      }

      function isFoundInLanguages(language) {
        let index = languages.findIndex(lang => lang.value === language.value);
        if (index >= 0) {
          return true
        }
        return false
      }

      let languagesForSelect = workingLanguages.filter(workingLanguage => isFoundInLanguages(workingLanguage));
      languagesForSelect = languagesForSelect.map(language => {
        return {label: language.value, value: language.value}
      });
      callback(undefined, languagesForSelect);
    });
  }

  getLanguageListForOrdering(callback) {
    this.getWorkingLanguages((err, languages) => {
      languages[0].selected = true;
      callback(err, {items: languages})
    });
  }

  overwriteWorkingLanguages(languages, callback) {
    workingLanguagesCache = languages;
    this.DSUStorage.setObject(constants.LANGUAGES_STORAGE_PATH, languages, callback);
  }
}

module.exports = LanguageService;
