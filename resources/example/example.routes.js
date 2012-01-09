"use strict";
var RegexRouter = require('../../components/router').RegexRouter;
var util_module = require('util');
var resource_component = require('../../components/resource');

var Router = exports.Router = function TestRouter() {
	var _self = this;
	RegexRouter.call(_self);
	
	_self.add(/^\/$/, function (request, response, callback) {
		// TODO cleanup
		resource_component.get('example').template('index.html', function (contents) {
			response.writeHead(200, {'Content-Type':'text/html'});
			response.end(contents);
			callback();
		}, function (error) {
			response.writeHead(404, {'Content-Type':'text/plain'});
			response.end("Not Found");
			callback();
		});
	});
	
	/*_self.add(/\w+/, function(request, response, extra, callback) {
		response.end("test:" + request.method + ":" + request.url.pathname + ":" + require('querystring').stringify(request.url.query));
		callback();
	})*/;
};

exports.unmatched = function (request, response, callback) {
	console.log("not found");
	console.log(request.url);
	response.writeHead(404, {'Content-Type':'text/plain'});
	response.end("Not Found");
	callback();
};

util_module.inherits(Router, RegexRouter);