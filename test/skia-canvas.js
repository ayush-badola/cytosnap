var chai = require('chai');
var expect = chai.expect;
var cytosnap = require('..');
var Promise = require('bluebird');
var cytoscape = require('cytoscape');
var dagre = require('cytoscape-dagre');
cytoscape.use(dagre);

describe('Skia-Canvas test', function() {
    
    var snap;
    
    beforeEach(async function(){
        snap = new cytosnap({
            engine: 'skia',
        });
        await snap.start();
    });
    afterEach(async function(){ // teardown
        await snap.stop();
        snap = null;
      });


      it('should save png image', async function(){
        const startTime = Date.now();
        const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;
        
        let cy = cytoscape({
            elements: [
              { data: { id: 'foo' }, group: 'nodes' },
              { data: { id: 'bar' }, group: 'nodes' },
              { data: { source: 'foo', target: 'bar' }, group: 'edges' },
            ],
            layout: {
                name: 'dagre',
                nodeSep: 200,
                rankSep: 200,
                edgeSep: 50,
                directed: true,
            }
          });

          let processedElements = [...cy.elements().jsons()];

        return snap.shot({
            elements: processedElements,
            format: 'png',
            width: 1000,
            height: 1000,
            background: 'white',
            resolvesTo: 'stream',
        }).then(function (img){
            if (!img) {
                console.error("snap.shot() returned undefined! Possible issue with Skia engine or cytosnap setup.");
                throw new Error('Image generation failed, received undefined.');
            }
            expect(img).to.exist;
            return img;
        }).then(async function (img){
            return await new Promise(function (resolve, reject){
                var out = require('fs').createWriteStream('./test/skiaimg.png');
                img.pipe(out);
                out.on('finish', function(){
                    const executionTime = Date.now() - startTime;
                    const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
                    const memoryUsed = finalMemory - initialMemory;
                    console.log(`Skia-Canvas rendering time: ${executionTime} ms`);
                    console.log(`Skia-Canvas memory used: ${memoryUsed.toFixed(2)} MB`);
                    resolve();
                });
                out.on('error', reject);
            })
        });
      });
});