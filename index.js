let Promise = require('bluebird');
let browserify = require('browserify');
let fs = require('fs');
let base64 = require('base64-stream');
let stream = require('stream');
let path = require('path');
let os = require('os');
let puppeteer = require('puppeteer');
let playwright = require('playwright');
let skiaCanvas = require('skia-canvas');
let typeofFn = typeof function(){};
let isFunction = x => typeof x === typeofFn;
let Handlebars = require('handlebars');
let readFile = Promise.promisify(fs.readFile);
let writeFile = Promise.promisify(fs.writeFile);

let callbackifyValue = function( fn ){
  return function( val ){
    if( isFunction(fn) ){ fn( null, val ); }

    return val;
  };
};

let callbackifyError = function( fn ){
  return function( err ){
    if( isFunction(fn) ){ fn( err ); }

    throw err;
  };
};


let getStream = function( text ){
  let s = new stream.Duplex();

  s.push( text );
  s.push( null );

  return s;
};

let browserSrc;

let browserifyBrowserSrc = function(){
  if( browserSrc != null ){
    return browserSrc;
  }

  browserSrc = new Promise(function( resolve ){
    browserify()
      .add( path.join(__dirname, './browser/index.js') )
      .bundle()
      .on( 'end', resolve )
      .pipe( fs.createWriteStream( path.join(__dirname, './browser/index.pack.js') ) );
  });

  return browserSrc;
};

let Cytosnap = function( opts = {} ){
  if( !(this instanceof Cytosnap) ){
    return new Cytosnap( opts );
  }

  this.options = Object.assign( {
    // top-level defaults -- none currently
    engine: opts.engine || 'puppeteer', 
    puppeteer: {
      args: opts.puppeteer?.args,
      headless: true
    },
    playwright: {
      args: opts.playwright?.args,
      headless: true
    },
    skia: {},
  }, opts );

  // options to pass to puppeteer.launch()
/*this.options.puppeteer = Object.assign({
  // defaults
  args: opts.args, // backwards compat
  headless: true
}, opts.puppeteer);*/
  this.running = false;
};

let extensions = [];

Cytosnap.use = function(exts){
  extensions = exts;
};

let wroteExtensionList = false;

let writeExtensionsList = function(){
  if( wroteExtensionList ){ return Promise.resolve(); }

  let readTemplate = () => readFile(path.join(__dirname, './browser/index.js.hbs'), 'utf8');

  let writeJs = contents => writeFile(path.join(__dirname, './browser/index.js'), contents);

  let fillTemplate = template => {
    return Handlebars.compile(template)({ extensions });
  };

  let done = () => wroteExtensionList = true;

  return Promise.try(readTemplate).then(fillTemplate).then(writeJs).then(done);
};

let proto = Cytosnap.prototype;

proto.start = function( next ){
  let snap = this;

  return Promise.try(function(){
    if(snap.options.engine == 'puppeteer'){
    return puppeteer.launch(snap.options.puppeteer);}
    else if(snap.options.engine == 'playwright'){
      return playwright.chromium.launch(snap.options.playwright);
    }
    else if(snap.options.engine == 'skia'){
      return null;
    }
    else{
      throw new Error ('Unsupported Engine' + snap.options.engine);
    }
  }).then(function( browser ){
    snap.browser = browser;

    snap.running = true;
  }).then( callbackifyValue(next) ).catch( callbackifyError(next) );
};

proto.stop = function( next ){
  let snap = this;

  return Promise.try(function(){
    if(snap.browser)
    snap.browser.close();
  }).then(function(){
    snap.running = false;
  }).then( callbackifyValue(next) ).catch( callbackifyError(next) );
};

proto.shot = function( opts, next ){
  let snap = this;
  let page;

  opts = Object.assign( {
    // defaults
    elements: [],
    style: [],
    layout: { name: 'grid' },
    format: 'png',
    background: 'transparent',
    quality: 85,
    width: 200,
    height: 200,
    resolvesTo: 'base64uri'
  }, opts );

  if( opts.format === 'jpg' ){
    opts.format = 'jpeg';
  } else if( opts.format === 'png' ){
    opts.quality = 0; // most compression
  }


  if( snap.options.engine === 'skia' ) {
    return Promise.try(async function() {
      const canvas = new skiaCanvas.Canvas(opts.width, opts.height);
      const ctx = canvas.getContext("2d");
      // Set background
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, opts.width, opts.height);


      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      opts.elements.forEach(el => {
        if (el.group === 'nodes'&& el.position) {
          minX = Math.min(minX, el.position.x);
          minY = Math.min(minY, el.position.y);
          maxX = Math.max(maxX, el.position.x);
          maxY = Math.max(maxY, el.position.y);
        }
      });

      // Calculate center of the bounding box
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      ctx.translate(opts.width / 2, opts.height / 2);

      ctx.scale(4.4, 4.4);

      ctx.translate(-centerX, -centerY);

      //Draw Nodes
      opts.elements.forEach(el => {
        if (el.group === 'nodes') {
          ctx.fillStyle = el.data.color || "black"; // Default color if not specified
          ctx.beginPath();
          ctx.arc(el.position.x, el.position.y, 10, 0, 2 * Math.PI); // Circle for node
          ctx.fill();
        }
      });

      // Draw edges
      opts.elements.forEach(el => {
        if (el.group === 'edges') {
          const sourceNode = opts.elements.find(n => n.data.id === el.data.source);
          const targetNode = opts.elements.find(n => n.data.id === el.data.target);

          if (sourceNode && targetNode) {
            ctx.beginPath();
            ctx.moveTo(sourceNode.position.x, sourceNode.position.y);
            ctx.lineTo(targetNode.position.x, targetNode.position.y);
            ctx.stroke();
          }
        }
      });

      let buffer = await canvas.toBuffer(opts.format, { quality: opts.quality });
      const base64Image = buffer.toString("base64");

      switch (opts.resolvesTo) {
        case 'base64uri': return `data:image/${opts.format};base64,${base64Image}`;
        case 'base64': return base64Image;
        case 'stream': return getStream(base64Image).pipe(base64.decode());
        default: throw new Error("Invalid resolve type: " + opts.resolvesTo);
      }
    })
    .then(callbackifyValue(next))
    .catch(callbackifyError(next));
  }


  return Promise.try(function(){
    return writeExtensionsList();
  }).then(function(){
    return browserifyBrowserSrc();
  }).then(function(){
    if(snap.options.engine == 'puppeteer'){
    return snap.browser.newPage();}
    else if(snap.options.engine == 'playwright'){
      return snap.browser.newPage();
    }
  }).then(function( puppeteerPage ){
    page = puppeteerPage;
  }).then(function(){
    if(snap.options.engine == 'playwright'){
    return page.setViewportSize({ width: opts.width, height: opts.height });}
    else if(snap.options.engine == 'puppeteer'){
      return page.setViewport({width: opts.width, height: opts.height});
    }
  }).then(function(){
    let patchUri = function(uri){
      if( os.platform() === 'win32' ){
        return '/' + uri.replace(/\\/g, '/');
      } else {
        return uri;
      }
    };
    if(snap.options.engine != 'skia')
    return page.goto( 'file://' + patchUri(path.join(__dirname, './browser/index.html')) );
  }).then(function(){
    if( !isFunction( opts.style ) ){ return Promise.resolve(); }

    let js = 'window.styleFunction = (' + opts.style + ')';

    return page.evaluate( js );
  }).then(function(){
    if( !isFunction( opts.layout ) ){ return Promise.resolve(); }

    let js = 'window.layoutFunction = (' + opts.layout + ')';

    return page.evaluate( js );
  }).then(function(){
    let js = 'window.options = ( ' + JSON.stringify(opts) + ' )';
    if(snap.options.engine != 'skia')
    return page.evaluate( js );
  }).then(function(){
    let js = 'document.body.style.setProperty("background", "' + opts.background + '")';
    if(snap.options.engine != 'skia')
    return page.evaluate( js );
  }).then(function(){
    if(snap.options.engine != 'skia')
    return page.evaluate(function(){
     /*global window, options, cy, layoutFunction, styleFunction */
      if( window.layoutFunction ){ options.layout = layoutFunction(); }

      if( window.styleFunction ){ options.style = styleFunction(); }

      cy.style( options.style );

      cy.add( options.elements );

      return new Promise(function(resolve) {
        cy.makeLayout( options.layout ).run();
        cy.one('layoutstop', resolve);
        setTimeout(resolve, 0);
  });

    });
  }).then(function(){
    if( opts.resolveTo === 'json' ){ return null; } // can skip in json case
    const screenshotoptions = {
      type: opts.format,
      encoding: 'base64'
    };
    if(opts.format == 'jpg'){screenshotoptions.quality = opts.quality}
    if(snap.options.engine === 'playwright'){delete screenshotoptions.encoding;}
    if(snap.options.engine != 'skia')
    return page.screenshot(screenshotoptions);
  }).then(function( screenshotResult ){

      if(snap.options.engine === 'playwright' && Buffer.isBuffer(screenshotResult)){
          screenshotResult = screenshotResult.toString('base64');
      }


    switch( opts.resolvesTo ){
      case 'base64uri':
        return 'data:image/' + opts.format + ';base64,' + screenshotResult;
      case 'base64':
        return screenshotResult;
      case 'stream':
        return getStream( screenshotResult ).pipe( base64.decode() );
      case 'json':
        return page.evaluate(function(){
          let posns = {};

          cy.nodes().forEach(function(n){
            posns[ n.id() ] = n.position();
          });

          return posns;
        });
      default:
        throw new Error('Invalid resolve type specified: ' + opts.resolvesTo);
    }
  }).then(function( img ){
    if(snap.options.engine != 'skia')
    return page.close().then(function(){ return img; });
  }).then( callbackifyValue(next) ).catch( callbackifyError(next) );
};

module.exports = Cytosnap;
