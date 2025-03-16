var chai = require('chai');
var expect = chai.expect;
var cytosnap = require('..');
var Promise = require('bluebird');

cytosnap.use([ 'cytoscape-dagre' ]);

describe('Playwright test', function() {
    var snap;
    this.timeout(10000);
    beforeEach(async function(){
        snap = new cytosnap({
            engine: 'playwright',
            playwright: {
                headless: true,
            },
        });
        await snap.start();
    });
    afterEach(async function(){ // teardown
        if (snap) {
            await snap.stop();
            snap = null;
          }
      });


      it('should save png image', async function(){
        const startTime = Date.now();
        const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;
        try{
         await snap.shot({
            elements: [
                {
                    data: {id: 'foo'}
                },
                {
                    data: {id: 'bar'}
                },
                {
                    data: {source: 'foo', target: 'bar'}
                },
            ],
            format: 'png',
            width: 1000,
            height: 1000,
            resolvesTo: 'stream'
        }).then(function (img){
            expect(img).to.exist;
            return img;
        }).then(async function (img){
            return await new Promise(function (resolve, reject){
                var out = require('fs').createWriteStream('./test/playwrightimg.png');
                img.pipe(out);
                out.on('finish', function(){
                    const executionTime = Date.now() - startTime;
                    const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
                    const memoryUsed = finalMemory - initialMemory;
                    console.log(`Playwright rendering time: ${executionTime} ms`);
                    console.log(`Playwright memory used: ${memoryUsed.toFixed(2)} MB`);
                    resolve();
                });
            });
            
        })
    }catch(err){
        console.error('Error in test: ', err);
        throw err;
    }
      });
});