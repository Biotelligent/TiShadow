/*
 * Copyright (c) 2011-2014 YY Digital Pty Ltd. All Rights Reserved.
 * Please see the LICENSE file included with this distribution for details.
 */

var path   = require("path"),
    fs     = require("fs"),
    spawn  = require("./spawn"),
    async  = require("async"),
    fs_map = require("./fs_map"),
    api    = require("./api"),
    bundle = require("./bundle"),
    config = require("./config"),
    uglify = require("./uglify"),
    logger = require("../../server/logger.js"),
    jshint = require("./jshint_runner"),
    wrench = require("wrench"),
    _      = require("underscore");

require("./fs_extension");

// Copies all Resource files and prepares JS files
function prepare(src, dst, callback) {
  var app_name = config.app_name;
  if (src.match("js$")){
    try {
      var src_text = uglify.toString(fs.readFileSync(src).toString(),src);
      if (src.match("_spec.js$")) {
        if (config.specType === "jasmine") {
          src_text =  "var __jasmine = require('/lib/jasmine');var methods = ['spyOn','it','xit','expect','runs','waits','waitsFor','beforeEach','afterEach','describe','xdescribe','jasmine'];methods.forEach(function(method) {this[method] = __jasmine[method];});"
          +src_text;
        } else if (config.specType === "mocha-should") {
          src_text =  "var should = require('/lib/should');\n"
            + "var sinon = require('/lib/sinon');\n"
          +src_text;
        } else if (config.specType === "mocha-chai") {
          src_text =  "var chai = require('/lib/chai'); var expect = chai.expect; var assert = chai.assert;\n"
            + "var sinon = require('/lib/sinon');\n"
          +src_text;
        }
        if (config.isAlloy) {
          src_text =
          "var Alloy = __p.require(\"alloy\"), _ = Alloy._, Backbone = Alloy.Backbone;\n"
          +src_text;
        }
      }
      else if(config.runCoverage && !src.match("spec/")) { //Instrumenting the application code with istanbul for code coverage
		var instrumentedCode = require("./coverage").instrumentCode(src_text, src);
		src_text = instrumentedCode;

		config.instrumentedfiles[src] = dst;// storing all instrumented file
      }

      fs.writeFile(dst,src_text, callback);
    } catch (e) {
      logger.error(e.message + "\nFile   : " + src + "\nLine   : " + e.line + "\nColumn : " + e.col);
      config.isWatching || process.exit(1);
    }
  } else { // Non-JS file - just pump it
    var  is = fs.createReadStream(src);
    var  os = fs.createWriteStream(dst);
    is.on("end", callback).pipe(os);
  }
}

function copyI18n(file, callback) {
  var read = fs.createReadStream(path.join(config.i18n_path,file));
  var write = fs.createWriteStream(path.join(config.tishadow_src, file));
  write.on('close',callback);
  read.pipe(write);
};

function finalise(file_list,callback) {
  logger.warn("JMH cli/support/compiler finalise - creating bundle");

  // Bundle up to go
  var total = file_list.files.length;
  bundle.pack(file_list.files,function(written) {
    logger.info(total+ " file(s) bundled.");
    fs_map.writeMap();
    fs.touch(config.last_updated_file);
    if (config.isBundle) {
      logger.info("Bundle Ready: " + config.bundle_file);
      if (callback) {
        callback();
      }
    } else {
      api.newBundle(config.isPatch?_.filter(file_list.files, function(f) { return f.match(".js$");}):null );
    }
  });
}

module.exports = function(env, callback, hlcompile) {
  config.buildPaths(env, function() {
    if (env.jshint) {
      logger.info("Running JSHint");
      jshint.checkPath(config.jshint_path);
    }
    var isHLCompile = (true === hlcompile) ? true : false;

    logger.warn("JMH cli/support/compiler Beginning Build Process isHLCompile=" + isHLCompile);
    // a js map of hashes must be built whether or not it is an update.
    if (config.isAlloy && !config.skipAlloyCompile) {
      if (config.platform === undefined) {
        logger.error("You need to use the --platform (android|ios) flag or have deployment-targets in tiapp.xml with an alloy project.");
        process.exit();
      }
      async.detectSeries(config.platform, function(platform, callback) {
        var alloy_command;
        //var args = ['compile', '-b','-l', '2', '--platform', platform, '--config', 'sourcemap=false'];
        var args = ['compile', '-b','-l', 'info', '--platform', platform, '--config', 'sourcemap=false'];
        if (config.alloyCompileFile) {
          args[7] = "sourcemap=false,file="+config.alloyCompileFile;
        }
      	if (isHLCompile || config.isHyperloop) {
      		args[0] = 'build';
	        logger.warn("JMH cli/support/compiler building Hyperloop for platform appc ti " + args.join(" "));
	        alloy_command = spawn("appc", ['ti'].concat(args), {stdio: "inherit"});
      	} else if (config.useAppcCLI) {
        	logger.warn("JMH Compiling Alloy appc " + ['alloy'].concat(args).join(" "));
          alloy_command = spawn("appc", ['alloy'].concat(args), {stdio: "inherit"});
        } else {
          alloy_command = spawn('alloy', args, {stdio: "inherit"});
        }

        alloy_command.on("exit", function(code) {
        	logger.warn("JMH cli/support/compiler compile completed for " + platform + " code=" + code + " isHLCompile=" + isHLCompile);
          if (code !== 0) {
            logger.error("Alloy Compile Error\n");
            callback(true);
          }

          if (isHLCompile) {
	        	logger.warn("JMH cli/support/compiler compile completed NOT cloning path, not execing beginCompile callback "   + config.res_alloy_path);
          	//callback(false);
          } else {
	        	logger.warn("JMH cli/support/compiler compile completed cloning path "  + config.res_alloy_path);
	          if (fs.existsSync(config.res_alloy_path)) {
	            wrench.copyDirSyncRecursive(
	              config.res_alloy_path,
	              path.join(config.resources_path,(platform === 'ios' ? 'iphone' : platform),'alloy'),
	              {preserve:true,preserveFiles:true}
	            );
	          }
	          callback(false);
	        }
          // JMH
          //var hyperloopplugin = config.plugins_path + '/hyperloop/hooks/' + platform + '/hyperloop';
          /*
          var hyperloopplugin = 'plugins/hyperloop/hooks/' + platform + '/hyperloop';
          logger.info("JMH hyperloop plugin at " + hyperloopplugin);
          var hyperloop = require(hyperloopplugin);
          var hl = new hyperloop();
          //hyperloop.init(); // _logger, _config, _cli, appc, hyperloopConfig, next
          hl.prepareBuildX(logger, function(e){
            logger.info("JMH hyperloop plugin callback for " + platform);
          });*/
        });
        alloy_command.on("error", function() {
          logger.error("Alloy Compile Error\n");
          callback(true);
        });
      },function(failed){
        if (failed) return;
        if (fs.existsSync(config.res_alloy_path)) {
          fs.rm_rf(config.res_alloy_path);
        }
        fs.touch(path.join(config.resources_path,'app.js'));
        fs_map.buildMap();
        beginCompile(callback);
      });;
      //Remove non-specific
    } else {
     	logger.warn("JMH cli/support/compiler calling BuildMap and begin compile ");
      fs_map.buildMap();
      beginCompile(callback);
    }
  });
};

function beginCompile(callback) {
  var file_list,i18n_list,spec_list,assets_list,hyperloop_list;
  var platformfolder = '';
  if (config.platform && (config.platform.length > 0)) {
  	platformfolder = config.platform[0];
  }
	config.hyperloop_path = path.join(config.hyperloop_path, platformfolder, 'js');

  if( config.isUpdate) {
    var last_stat = fs.statSync(config.last_updated_file);
    file_list = fs_map.mapFiles();
    if (config.isModule)  {
      assets_list = fs.getList(config.assets_path,last_stat.mtime);
    }
    if (config.isHyperloop)  {
      hyperloop_list = fs.getList(config.hyperloop_path,last_stat.mtime);
    }
    i18n_list = fs.getList(config.i18n_path,last_stat.mtime);
    spec_list = fs.getList(config.spec_path,last_stat.mtime);

    if (file_list.files.length === 0 && (!config.isModule || assets_list.files.length === 0) && (!config.isHyperloop || hyperloop_list.files.length === 0) && i18n_list.files.length === 0 && spec_list.files.length === 0) {
      logger.warn("Nothing to update.");
      return;
    }
  } else {
   logger.warn("JMH tishadow/cli/support/compiler.js beginCompile() dirs config.tishadow_build=" + config.tishadow_build
   + " config.tishadow_src=" + config.tishadow_src
   + " config.tishadow_dist=" + config.tishadow_dist);

   if (!fs.existsSync(config.build_path)){
      fs.mkdirSync(config.build_path, 0755);
    }
    //Clean Build Directory
    if (fs.existsSync(config.tishadow_build)) {
      fs.rm_rf(config.tishadow_build);
    }
    // Create the tishadow build paths build/tishadow, build/tishadow/src, build/tishadow/dist
    fs.mkdirs([config.tishadow_build, config.tishadow_src, config.tishadow_dist]);
    file_list = fs.getList(config.resources_path);
    if (config.isModule) {
      assets_list = fs.getList(config.assets_path);
    }
    if (config.isHyperloop)  {
      hyperloop_list = fs.getList(config.hyperloop_path);
    }
    i18n_list = fs.getList(config.i18n_path);
    spec_list = fs.getList(config.spec_path);
  }

  // Build the required directory structure
  fs.mkdirs(file_list.dirs, config.tishadow_src);
  fs.mkdirs(i18n_list.dirs, config.tishadow_src);


  if(spec_list.files.length > 0) {
    if (!fs.existsSync(config.tishadow_spec)) {
      fs.mkdirSync(config.tishadow_spec, 0755);
    }
    fs.mkdirs(spec_list.dirs, config.tishadow_spec);
    spec_list.files = spec_list.files.map(function(file) { return "spec/" + file;});
    spec_list.dirs = ["spec"].concat(spec_list.dirs.map(function(dir) {return "spec/" + dir;}));
  }


  // prepare tasks to process files
  var process_tasks = file_list.files.map(function(file) {
    return _.bind(prepare, null, path.join(config.resources_path,file), path.join(config.tishadow_src,file));
  }).concat(spec_list.files.map(function(file) {
    return _.bind(prepare, null, path.join(config.base,file), path.join(config.tishadow_src,file));
  }));

  // Add build/hyperloop/[android]/js to process_tasks
  if (config.isHyperloop && hyperloop_list.files.length > 0) {
  	logger.warn("JMH cli/support/compiler.js beginCompile isHyperloop=true adding files to copy as ");
  	var file =  hyperloop_list.files[0];
  	logger.warn("JMH copy " + path.join(config.hyperloop_path,file) + " ---to--- " + path.join(config.tishadow_src, platformfolder, file));
    process_tasks = process_tasks.concat(hyperloop_list.files.map(function(file) {
    	return _.bind(prepare, null, path.join(config.hyperloop_path,file), path.join(config.tishadow_src, platformfolder, file));
    }));
  }

  // if acting on a native module - see https://github.com/dbankier/TiShadow/commit/bec799b3d03660704ce6ab303f5e28110b86f051
  if (config.isModule && assets_list.files.length > 0) {
    // create paths
  	fs.mkdirs([config.module_name], config.tishadow_src);
  	fs.mkdirs(assets_list.dirs, config.module_path);
    // add files for processing
    process_tasks = process_tasks.concat(assets_list.files.map(function(file) {
      var fileName = file.slice(0,file.lastIndexOf('.'));
      if(fileName == config.module_name){
      	return _.bind(prepare, null, path.join(config.assets_path,file), path.join(config.tishadow_src, file));
      } else {
      	return _.bind(prepare, null, path.join(config.assets_path,file), path.join(config.tishadow_src, config.module_name, file));
      }
    }));
    console.log(process_tasks);
    // modify for bundling
    assets_list.files = assets_list.files.map(function(file) {
      var filePath = config.module_name + "/" + file;
      var fileName = file.slice(0,file.lastIndexOf('.'));
      if(fileName == config.module_name){
      	filePath = file;
      }
      return filePath;
    });
  }

  async.series([
    _.bind(async.eachLimit, null, i18n_list.files, 100, copyI18n), //localisation filed
    _.bind(async.parallelLimit, null, process_tasks, 100), // source, assets, specs
    function() {
      file_list.files = file_list.files.concat(i18n_list.files).concat(spec_list.files);

      // JMH Remove "hyperloop" subfolder from /resources/hyperloop for the dist zup
      file_list.files = file_list.files.map(function(file) {
	      return file.replace('hyperloop/', '');
	    });

      if (config.isModule) {
        file_list.files = file_list.files.concat(assets_list.files);
      }
      finalise(file_list,callback);
    }
  ]);
};
exports.beginCompile = beginCompile;
module.exports.beginCompile = beginCompile;