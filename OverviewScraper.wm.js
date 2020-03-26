var scraper = require('table-scraper');
const fs = require('fs');

scraper
    .get('https://www.worldometers.info/coronavirus/')
    .then(function (tableData) {
        let date = new Date();
        let fileName = date.getFullYear().toString() 
        + (date.getMonth() + 1).toString() 
        + date.getDate().toString()
        + date.getHours().toString().padStart(2, '0')
        + date.getMinutes().toString().padStart(2, '0')
        + date.getSeconds().toString().padStart(2, '0');

        let mappedData = tableData[0].map(country => {
            return {
                country: country['Country,Other'],
                totalCases: (country['TotalCases'] && country['TotalCases'].replace(',', '')) || 0,
                newCases: (country['NewCases'] && country['NewCases'].replace(',', '').replace('+', '')) || 0,
                totalDeaths: (country['TotalDeaths'] && country['TotalDeaths'].replace(',', '')) || 0,
                newDeaths: (country['NewDeaths'] && country['NewDeaths'].replace(',', '').replace('+', '')) || 0,
                totalRecovered: (country['TotalRecovered'] && country['TotalRecovered'].replace(',', '')) || 0,
                activeCases: (country['ActiveCases'] && country['ActiveCases'].replace(',', '')) || 0,
                severe: (country['Serious,Critical'] && country['Serious,Critical'].replace(',', '')) || 0,
                density: (country['Tot Cases/1M pop'] && country['Tot Cases/1M pop'].replace(',', '')) || 0
            }
        });
        
        mappedData = mappedData.filter(x => x.country !== "Total:");

        fs.writeFileSync('D:/Experiments/CodeFi/CovidTracker/Data/Overview/Raw/' + fileName + '.json', JSON.stringify(mappedData));
    });