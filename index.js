const cheerio = require('cheerio')
const request = require('request');
const JSON5 = require('json5')
const fs = require('fs');
const Excel = require('exceljs');
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();

let date = new Date();
let filename = date.getFullYear().toString()
    + (date.getMonth() + 1).toString()
    + date.getDate().toString()
    + date.getHours().toString().padStart(2, '0')
    + date.getMinutes().toString().padStart(2, '0')
    + date.getSeconds().toString().padStart(2, '0');

const saveDir = '/tmp/';
const ecdcSaveDir = '/tmp/ecdc.xlsx';
const gcpBucketName = 'covid-excel';

const wmSite = 'https://www.worldometers.info/coronavirus/';
const excelHeaderKvp = [
    { key: "date", header: "DateRep" },
    { key: "day", header: "Day", },
    { key: "month", header: "Month" },
    { key: "year", header: "Year" },
    { key: "cases", header: "Cases" },
    { key: "deaths", header: "Deaths" },
    { key: "recovered", header: "Recovered" },
    { key: "country", header: "Countries and territories" }
]

const sourceCountryNameDict = {
    'United_Kingdom': 'uk',
    'United_States_of_America': 'usa',
    'South_Korea': 's. korea'
}

const malaysiaRecoveredStat = {
    "2.15": 7,
    "2.16": 1,
    "2.17": 1,
    "2.18": 2,
    "2.19": 4,
    "2.20": 2,
    "2.21": 0,
    "2.22": 0,
    "2.23": 1,
    "2.24": 2,
    "2.25": 0,
    "2.26": 0,
    "2.27": 2,
    "2.28": 0,
    "2.29": 0,
    "3.01": 0,
    "3.02": 0,
    "3.03": 0,
    "3.04": 0,
    "3.05": 0,
    "3.06": 0,
    "3.07": 1,
    "3.08": 1,
    "3.09": 0,
    "3.10": 1,
    "3.11": 1,
    "3.12": 6,
    "3.13": 1,
    "3.14": 0,
    "3.15": 2,
    "3.16": 7,
    "3.17": 0,
    "3.18": 7,
    "3.19": 11,
    "3.20": 15,
    "3.21": 39,
    "3.22": 25,
    "3.23": 20,
    "3.24": 24,
    "3.25": 16,
    "3.26": 16
}

var wmInputList = [];
var wmResult = [];
var wmExcelData = [];
var ecdcExcelData = [];
var retryCount = 0;

exports.execScrapeFunc = async () => { await startScrapeWmSite() }
//startScrapeWmSite()

async function cleanupTempFiles() {
    let wmLatestExcel = saveDir + filename + '.xlsx';

    let deleteWmLatest = () => new Promise((resolve, reject) => {
        fs.unlink(wmLatestExcel, function (err) {
            if (err) throw err;
            console.log(`successfully deleted ${wmLatestExcel}`);

            resolve();
        });
    })

    let wmLatestJson = saveDir + filename + '.json';

    let deleteWmLatestJson = () => new Promise((resolve, reject) => {
        fs.unlink(wmLatestJson, function (err) {
            if (err) throw err;
            console.log(`successfully deleted ${wmLatestJson}`);

            resolve();
        });
    })

    let deleteEcdc = () => new Promise((resolve, reject) => {
        fs.unlink(ecdcSaveDir, function (err) {
            if (err) throw err;
            console.log(`successfully deleted ${ecdcSaveDir}`);

            resolve();
        });
    })

    await deleteWmLatest()
        .then(async () => { await deleteWmLatestJson() })
        .then(async () => { await deleteEcdc() })
}

async function uploadFile(bucketName, saveDatas) {

    for(let saveData of saveDatas)
    {
        await storage.bucket(bucketName).upload(saveData.filePath, {
            public: true,
            destination: 'covid-latest' + '.' + saveData.ext,
            gzip: true,
            metadata: {
                cacheControl: 'public, max-age=31536000',
            },
        });
    
        console.log(`covid-latest.${saveData.ext} uploaded to ${bucketName}.`);
    
        await storage.bucket(bucketName).upload(saveData.filePath, {
            destination: 'History/' + saveData.fileName,
            gzip: true,
            metadata: {
                cacheControl: 'public, max-age=31536000',
            },
        });
    
        console.log(`${saveData.fileName} uploaded to ${bucketName} History.`);
    }
}

async function mergeWmEcdcResult() {

    var workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(ecdcSaveDir)
        .then(async function () {
            var worksheet = workbook.getWorksheet();

            let headers = [];

            worksheet.eachRow({ includeEmpty: true }, function (row, rowNumber) {

                if (rowNumber == 1)
                    headers = row.values.splice(1);
                else {
                    let rowData = row.values.splice(1);
                    let mappedData = headers.reduce((acc, current, i) => {
                        let keyObj = excelHeaderKvp.filter(x => x.header == current)[0];

                        return keyObj ? { ...acc, ... { [keyObj.key]: rowData[i] } } : acc;
                    }, {})

                    if (!sourceCountryNameDict[mappedData['country']]
                        && !wmInputList.filter(x => x.country.toLowerCase() == mappedData['country'].toLowerCase())[0])
                        ecdcExcelData.push(mappedData);
                }
            });

            await writeResultToExcel([...wmExcelData, ...ecdcExcelData])
            await writeResultToJson([...wmExcelData, ...ecdcExcelData])
        })
        .then(async function () {
            await uploadFile(gcpBucketName, [
                {"filePath": saveDir + filename + '.xlsx', "fileName": filename + '.xlsx', "ext": "xlsx"},
                {"filePath": saveDir + filename + '.json', "fileName": filename + '.json', "ext": "json"}
            ]).catch(console.error)
        })
        .then(async function () {
            await cleanupTempFiles();
            console.log("Done clean up temp files")
        });
}

function startExtractEcdcData() {
    console.log('Start extract data from ECDC.')

    return new Promise((resolve, reject) => {
        let date = new Date();
        urlDate = date.getFullYear().toString() + '-' + (date.getMonth() + 1).toString().padStart(2, '0') + '-' + (date.getDate() - 1).toString().padStart(2, '0')

        request('https://www.ecdc.europa.eu/sites/default/files/documents/COVID-19-geographic-disbtribution-worldwide-' + urlDate + '.xlsx')
            .on('response', async function (response) {
                await timeout(3000)
                await mergeWmEcdcResult();

                console.log('Done Merge Wm and Ecdc Results')
                resolve();
            })
            .pipe(fs.createWriteStream(ecdcSaveDir))
    })
}

async function startScrapeWmSite() {
    scrapeRequest = () => new Promise((resolve, reject) => {
        request(wmSite, async function (error, response, html) {
            console.log('Requested Worldometer site html')

            if (!error && response.statusCode == 200) {
                const $ = cheerio.load(html)

                const options = {
                    rowForHeadings: 0,  // extract th cells from this row for column headings (zero-based)
                    ignoreHeadingRow: true, // Don't tread the heading row as data
                    ignoreRows: [],
                }
                const jsonReponse = []
                const columnHeadings = []

                $('#main_table_countries_today').each(function (i, table) {
                    var trs = $(table).find('tr')

                    // Set up the column heading names
                    getColHeadings($(trs[options.rowForHeadings]))

                    // Process rows for data
                    $(table).find('tr').each(processRow)
                })

                wmInputList = jsonReponse.filter(x => x.href).map(x => { return { country: x['Country,Other'], url: wmSite + x['href'] } });

                await scrapeAvailableCountryData(wmInputList);

                function getColHeadings(headingRow) {
                    const alreadySeen = {}

                    $(headingRow).find('th').each(function (j, cell) {
                        let tr = $(cell).text().trim()

                        if (alreadySeen[tr]) {
                            let suffix = ++alreadySeen[tr]
                            tr = `${tr}_${suffix}`
                        } else {
                            alreadySeen[tr] = 1
                        }

                        columnHeadings.push(tr)
                    })
                }

                function processRow(i, row) {
                    const rowJson = {}

                    $(row).find('td').each(function (j, cell) {
                        rowJson[columnHeadings[j]] = $(cell).text().trim()

                        let tagEl = $(cell).get()[0].firstChild;
                        tagEl && tagEl.type == 'tag' && tagEl.attribs['href'] && (rowJson['href'] = tagEl.attribs['href'])
                    })

                    // Skip blank rows
                    if (JSON.stringify(rowJson) !== '{}') jsonReponse.push(rowJson)
                }
            } else {
                console.log(`Error: ${error}`);
                console.log(`ResponseCode: ${response.statusCode}`);

                if(retryCount++ < 3){
                    console.log(`Retry func:startScrapeWmSite. Count: ${retryCount}`)
                    await scrapeRequest()
                }
            }

            console.log('Resolving Main function.')
            resolve();
        })
    })

    await scrapeRequest()

    console.log(`Executed : ${new Date()}`)
}

function scrapeAvailableCountryData(inputs) {
    return new Promise((resolve, reject) => {
        inputs.forEach(input => {
            request(input.url, async function (error, response, html) {
                if (!error && response.statusCode == 200) {

                    let countryResult = new countryData(input.country);

                    const parsedHtml = cheerio.load(html)
                    const scripts = parsedHtml('script');

                    for (let a = 0; a < scripts.length; a++) {

                        let script = scripts[a];

                        if (script.attribs['type'] == 'text/javascript'
                            && !script.attribs['src']
                            && script.firstChild) {

                            if (script.firstChild.data.indexOf('Total Coronavirus Cases') != -1) {
                                let textData = script.firstChild.data.substring(
                                    script.firstChild.data.lastIndexOf("Highcharts.chart('coronavirus-cases-linear',") + 44,
                                    script.firstChild.data.indexOf(");")
                                ).trim();

                                let data = JSON5.parse(textData);

                                countryResult.totalCases = toDateStatCumulative(data.xAxis.categories, data.series[0].data)
                            }
                            else if (script.firstChild.data.indexOf('Total Coronavirus Deaths') != -1) {

                                let textData = script.firstChild.data.substring(
                                    script.firstChild.data.lastIndexOf("Highcharts.chart('coronavirus-deaths-linear',") + 45,
                                    script.firstChild.data.indexOf(");")
                                ).trim();

                                let data = JSON5.parse(textData);

                                countryResult.totalDeaths = toDateStatCumulative(data.xAxis.categories, data.series[0].data)
                            }

                            else if (script.firstChild.data.indexOf('New Recoveries') != -1) {
                                let textData = script.firstChild.data.substring(
                                    script.firstChild.data.lastIndexOf("Highcharts.chart('cases-cured-daily',") + 37,
                                    script.firstChild.data.indexOf(");")
                                ).trim();

                                let data = JSON5.parse(textData);

                                countryResult.totalRecovered = toDateStatDaily(data.xAxis.categories, data.series.filter(x => x.name === 'New Recoveries')[0].data)
                            }
                        }

                    }

                    wmResult.push(countryResult);

                    if (wmResult.length === inputs.length) {
                        wmResult.forEach(country => {

                            let countryExcelData = [];

                            country.totalCases.forEach(currentCase => {
                                countryExcelData.push(new excelDataRow(currentCase.date, currentCase.quantity, 0, 0, country.countryName))
                            })

                            country.totalDeaths.forEach(currentDeath => {
                                let temp = countryExcelData.filter(x => x.rawDate === currentDeath.date)[0];

                                if (temp)
                                    temp.deaths = currentDeath.quantity;
                                else
                                    countryExcelData.push(new excelDataRow(currentDeath.date, 0, currentDeath.quantity, 0, country.countryName))
                            })

                            //Temp Manual Data
                            if (country.countryName == 'Malaysia') {
                                country.totalRecovered.forEach(currentRecovered => {
                                    let temp = countryExcelData.filter(x => x.rawDate === currentRecovered.date)[0];

                                    if (temp) {
                                        msiaDayRecover = malaysiaRecoveredStat[temp.month.toString() + '.' + temp.day.toString()];
                                        temp.recovered = msiaDayRecover ? msiaDayRecover : 0;
                                    }
                                })
                            } else {
                                country.totalRecovered.forEach(currentRecovered => {
                                    let temp = countryExcelData.filter(x => x.rawDate === currentRecovered.date)[0];

                                    if (temp)
                                        temp.recovered = currentRecovered.quantity;
                                    else
                                        countryExcelData.push(new excelDataRow(currentRecovered.date, 0, 0, currentRecovered.quantity, country.countryName))
                                })
                            }

                            wmExcelData = [...wmExcelData, ...countryExcelData]
                        })

                        console.log('Done scraping individual countries from Worldometer.')
                        await startExtractEcdcData();

                        console.log('Done all jobs. Resolving.')
                        resolve();
                    }
                }
            });

        });
    })
}

function toDateStatCumulative(dateList, quantityList) {

    if (dateList.length !== quantityList.length)
        throw Error();

    let dateStat = dateList.reduce((acc, current, index) => {
        return index > 0 ? [...acc, { date: current, quantity: quantityList[index] - quantityList[index - 1] }] :
            [...acc, { date: current, quantity: quantityList[index] }]
    }, [])

    return dateStat;
}

function toDateStatDaily(dateList, quantityList) {

    if (dateList.length !== quantityList.length)
        throw Error();

    let dateStat = dateList.reduce((acc, current, index) => {
        return [...acc, { date: current, quantity: quantityList[index] }]
    }, [])

    return dateStat;
}

function writeResultToJson(result) {
    // Group By Countries
    let saveData = {};
    
    saveData.countries = [... new Set(result.map(x => x.country))].sort();
    saveData.data = result.reduce((acc, current) => {
        let clonedCurr = JSON.parse(JSON.stringify(current))

        if(acc[clonedCurr.country]){
            acc[clonedCurr.country].push(clonedCurr);
        }else{
            acc[clonedCurr.country] = []
            acc[clonedCurr.country].push(clonedCurr)
        }

        delete clonedCurr.date;
        delete clonedCurr.country;
        delete clonedCurr.rawDate;
        clonedCurr.recovered = clonedCurr.recovered? clonedCurr.recovered: 0;
        
        return acc;
    }, {})

    //Sort all date
    for(var country in saveData.data){
        saveData.data[country] = saveData.data[country].sort((a, b) => { return (a.year.toString() + a.month + a.day) - (b.year.toString() + b.month + b.day)})
    }

    fs.writeFileSync(saveDir + filename + '.json', JSON.stringify(saveData));
}

async function writeResultToExcel(result) {
    //fs.mkdirSync(saveDir, { recursive: true });

    var workbook = new Excel.Workbook();
    var sheet = workbook.addWorksheet('Sheet 1');

    sheet.columns = excelHeaderKvp;

    //adding each in sheet
    result.forEach(x => {
        sheet.addRow(x);
    });

    await workbook.xlsx.writeFile(saveDir + filename + '.xlsx')
}

function getMonthNumber(monthText) {
    switch (monthText) {
        case "Jan":
            return 1;
        case "Feb":
            return 2;
        case "Mar":
            return 3;
        case "Apr":
            return 4;
        case "May":
            return 5;
        case "Jun":
            return 6;
        case "Jul":
            return 7;
        case "Aug":
            return 8;
        case "Sep":
            return 9;
        case "Oct":
            return 10;
        case "Nov":
            return 11;
        case "Dec":
            return 12;
        default:
            return 0;
    }
}

function countryData(countryName) {
    this.countryName = countryName;
    this.totalCases = [];
    this.totalDeaths = [];
    this.totalRecovered = [];
}

function excelDataRow(date, cases, deaths, recovered, country) {
    this.rawDate = date;
    let splitedDate = date.split(" ");

    this.date = getMonthNumber(splitedDate[0]).toString() + '/' + splitedDate[1] + '/' + 2020;
    this.day = splitedDate[1];
    this.month = getMonthNumber(splitedDate[0]);
    this.year = 2020;

    this.cases = cases;
    this.deaths = deaths;
    this.recovered = recovered;
    this.country = country;
}

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}