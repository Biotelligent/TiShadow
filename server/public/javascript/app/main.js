var app = angular.module('tishadow', []);

var $apply = function($scope){
  if(!$scope.$$phase){
    $scope.$apply();
  }
};

function downloadInnerHtml(filename, elId, mimeType) {
  var elHtml = document.getElementById(elId).innerHTML;
  var link = document.createElement('a');
  mimeType = mimeType || 'text/plain';

  link.setAttribute('download', filename);
  link.setAttribute('href', 'data:' + mimeType  +  ';charset=utf-8,' + encodeURIComponent(elHtml));
  link.click();
}

// Main controller
app.controller('mainController', ['$scope', '$timeout', '$http', '$sce', function($scope, $timeout, $http, $sce){
  $scope._       = _;
  $scope.devices = {};
  $scope.inspect = {};
  $scope.logs = [];
  var api = [];
  var editor;


  var TiShadow = {};
  TiShadow.init = function (session, guest){
    var socket = io.connect();

    socket.on('connect', function(data) {
      socket.emit("join", {name: 'controller'});
      socket.emit("snippet", {code: "console.inspect(me)"});
    });

    socket.on('device_connect', function(e){
      $scope.devices[e.id] = {
        name: e.name,
        id: e.id
      };
      $apply($scope);
    });

    socket.on('device_disconnect', function(e){
      delete $scope.devices[e.id];
      $apply($scope);
    });

    socket.on('device_log', function(e) {
      if (e.level === "INSPECT") {
        $scope.inspect.values = [];
        $apply($scope);
        var current_values = JSON.parse(e.message);
        if (current_values._api) { 
          var current_api = current_values._api.replace(/^Ti\./, "Titanium.");
          var oapi = _.find(api.types, function(a) { return a.name === current_api});
          var tooltips = {};
          if (oapi) {
            oapi.properties.forEach(function(p) {
              if (current_values[p.name] === undefined) {
                current_values[p.name] = p.type === "Boolean" ? false : "";
              }
              tooltips[p.name] = $sce.trustAsHtml(p.description);
            });
          }
          $scope.tooltips = tooltips;
        }
        $scope.inspect.values = current_values;
        $apply($scope);
      } else if (e.level ==="SPY") {
        $scope.currentSpy = e.message;
        $apply($scope);
      } else {
        var now = new Date();
        var minutes = now.getMinutes();
        var seconds = now.getSeconds();
        var log = now.getHours() + ":" + (minutes < 10 ? "0" : "") +  minutes + ":" + (seconds < 10 ? "0" : "" ) + seconds + " [" + e.level + "] [" + e.name + "]    " + (e.message === undefined ? 'undefined' : e.message.toString().replace("\n","<br/>"));
        var style = e.level === "ERROR"  || e.level === "FAIL" ? " error" : e.level === "WARN" ? "warning" : e.level === "INFO" ? " success" : " info";
        $scope.logs.push({
          level: e.level,
          log: log,
          style: style
        });
        $apply($scope);
        $("#console").scrollTop($("#console")[0].scrollHeight);
      }
    });
    TiShadow.socket = socket;
  };
  $scope.submit = function() {
    TiShadow.socket.emit("snippet", {code: editor.getSession().getValue()});
  };
  $scope.downloadFile = function(){
    downloadInnerHtml('logfile_' + new Date().getTime(), 'console', 'text/html');
  };
  $scope.update = function(key,value, stack) {
    TiShadow.socket.emit("snippet", {
      code: "me" + stack.map(function(k) {return "['"+k+"']";}).join("") + "['"+key+"']" + "= " + value + ";" +
            "console.inspect(me)"
    });
  };
  $scope.inspectChildren = function(key,value, stack) {
    TiShadow.socket.emit("snippet", {code: "me = me" + stack.map(function(k) {return "['"+k+"']";}).join("") + ".children;" + 
            "console.inspect(me)"
    });
  };
  $scope.inspectReset = function() {
    TiShadow.socket.emit("snippet", {code: "me = getSpy('"+$scope.currentSpy+"');" + 
            "console.inspect(me)"
    });
  }
  $scope.closeApp = function() {
    TiShadow.socket.emit("snippet", {code: "closeApp();"});
  }
  $scope.clearLogs = function() {
    $apply($scope);
    $("#console").setValue("Cleared");
    $scope.logs = [];
    TiShadow.socket.emit("snippet", {code: "clearLogs();"});
  }
  $scope.screenShot = function() {
    TiShadow.socket.emit("snippet", {code: "screenshot();"});
  }
  $scope.loadREPLFile = function() {
    //var callback = function (data, status, xhr) {
    //  //data will be the xml returned from the server
    //  if (status == 'success') {
    //    //var editor = ace.edit("editor");
    //    //apparently, only modes supported are 'html', 'javascript' & 'text'
    //    editor.setValue(data);
    //  }
    //};
    ////using jQuery to fire off an ajax request to load the xml,
    ////using our callback as the success function
    ////var txt = document.getElementById('editor').innerHTML;
    //window.requestFileSystem = window.requestFileSystem ||
    //    window.webkitRequestFileSystem;
    //
    //// Create a variable that will store a reference to the FileSystem.
    //var filesystem = null;
    // $.ajax(
    //    {
    //      url : '/testing/cd_catalog.xml',
    //      dataType : 'text', //explicitly requesting the xml as text, rather than an xml document
    //      success : callback
    //    }
    //);
    //
    //"/Users/justin/Develop/BiotelligentWorkspace/zoopachat/repl/zoopa-listselect.js";
  }
  $scope.keypress = function(evt, key,value, stack) {
    if (evt.which===13){
      if (value.match(/^Ti(tanium)?\./)) {
        return $scope.update(key,value,stack);
      }
      var code = "";
      if (key.indexOf("font") !== -1) {
        var font = eval("$scope.inspect.values"+ stack.map(function(k) {return "['"+k+"']";}).join("")); 
        font[key] = value;
        code = "me" + stack.map(function(k) {return "['"+k+"']";}).join("") + " = "+ JSON.stringify(font) +";";
      } else { 
        code = "me" + stack.map(function(k) {return "['"+k+"']";}).join("") + "['"+key+"']"+ "= '" + value + "';";
      }
      TiShadow.socket.emit("snippet", {code: code  + "console.inspect(me)"});
    }
  };
  // Get Titanium API
  $http.get("/api").success(function (data, status, headers, config) {
    api = data;
    TiShadow.init();
  });

  $timeout(function(){
    editor = ace.edit("editor");
    //editor.setTheme("ace/theme/twilight");
    //JMH
    editor.setTheme("ace/theme/monokai");

    var JavaScriptMode = require("ace/mode/javascript").Mode;
    editor.getSession().setMode(new JavaScriptMode());

    editor.getSession().setTabSize(2);
    editor.setHighlightActiveLine(true);
    editor.resize();


    $("#editor").keypress(function (event) {
      if ((event.which == 115 && event.ctrlKey) || (event.which == 115 && event.metaKey)){
        $scope.submit();
        event.preventDefault();
        return false;
      }
    });
  });

}]);
app.directive('tooltip', function(){
    return {
        restrict: 'A',
        link: function(scope, element, attrs){
            $(element).hover(function(){
                $(element).tooltip('show');
            }, function(){
                $(element).tooltip('hide');
            });
        }
    };
});
