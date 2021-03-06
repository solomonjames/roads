/*
 * gfw.js - resource.js
 * Copyright(c) 2011 Aaron Hedges <aaron@dashron.com>
 * MIT Licensed
 */

"use strict";
//var fs_module = require('fs');
var url_module = require('url');
var mongoose_module = require('mongoose');
var http_module = require('http');
// todo replace this with a chunked renderer like mu?
//var hogan_module = require('hogan.js');

//var static_component = require('./static');
//var request_component = require('./request_wrapper');
//var response_component = require('./response_wrapper');
var accept_header_component = require('./accept_header');
var view_component = require('./view');
var View = view_component.View;
var Firebug = require('./firenode/firenode').Firebug;
var Cookie = require('./cookie').Cookie;
var Router = require('./router').RegexRouter;

var _resources = {};
var _resource_dir = __dirname.replace('components', 'resources/');

/**
 * Set the default directory  to load resources from
 * @param {String} directory 
 */
var set_resource_dir = exports.setDir = function (directory) {
	if (directory.charAt(directory.length) != '/') {
		directory = directory + '/';
	}
	
	_resource_dir = directory;
};

/**
 * Build a single resource by name, and cache it
 * 
 * @param {String}
 *            name
 * @param {Object}
 *            config
 * @return {Resource}
 */
var get_resource = exports.get = function (name, config) {
	if (typeof _resources[name] == "undefined" || _resources[name] == null) {
		console.log("Loading Resource:" + name);
		_resources[name] = build(name, require(_resource_dir + name + '/' + name + '.desc.js'));
	}

	return _resources[name];
};

/**
 * Removes a single resource from the cache list
 * 
 * @param  {[type]} name [description]
 * @return {[type]}
 */
var remove_resource = exports.remove = function (name) {
	_resources[name] = null;
};

/**
 * Free up the memory of all resources built within this module
 */
var clear = exports.clear = function () {
	_resources = {};
};

/**
 * [build description]
 * @param  {[type]} description [description]
 * @return {[type]}
 */
var build = exports.build = function (name, description) {
	var i = 0, j = 0;
	var key = null;
	var route = null;
	var resource = new Resource(name);

	resource.uri = description.uri;
	resource.directory = __dirname.replace("components", '') + 'resources/' + name;
	resource.template_dir = resource.directory + '/templates/';
	resource.template = description.template;

	resource.router.unmatched_route = description.unmatched_route;
	resource.config = description.config;

	for (i = 0; i < description.routes.length; i++) {
		route = description.routes[i];
		if (typeof route.options != "object") {
			route.options = {};
		}
		resource.addRoute(route.match, route, route.options.keys);
	}

	for (i = 0; i < description.dependencies.length; i++) {
		resource.addChild(get_resource(description.dependencies[i]));
	}


	if (typeof resource.config.db === "object" && typeof resource.config.db.connection === "string") {
		resource.db = mongoose_module.createConnection(resource.config.db.connection);
		populate_child_connections(resource.children, resource.db);
	}

	for (key in description.models) {
		resource.addModel(key, description.models[key]);
	}

	return resource;
};

/**
 * Iterates through all dependent resources and applies a datbase connection if not pre-configured for one
 * @param  {[type]} children   [description]
 * @param  {[type]} connection [description]
 * @return {[type]}
 */
var populate_child_connections = function (children, connection) {
	var key = null;
	for (key in children) {
		if (typeof children[key].db === "undefined" || children[key].db === null) {
			children[key].db = connection;
			// we want to fill all empty children with the provided default connection
			// this might not  be the right path
			populate_child_connections(children[key].children, connection);
		}
	}
};

/**
 * [Resource description]
 * @param {[type]} name [description]
 */
var Resource = exports.Resource = function Resource (name) {
	this.name = name;
	this.config = {};
	this.router = new Router();
	this.models = {};
	this.resources = {};
	this.db = null;
	this.unmatched_route = null;
};

Resource.prototype.name = '';
Resource.prototype.uri = '';
Resource.prototype.config = null;
Resource.prototype.directory = '';
Resource.prototype.template_dir = '';
Resource.prototype.template = null;
Resource.prototype.router = null;
Resource.prototype.resources = null;
Resource.prototype.models = {};
Resource.prototype.db = null;

/**
 * [getResource description]
 * @param  {[type]} name [description]
 * @return {[type]}      [description]
 */
Resource.prototype.getResource = function (name) {
	return get_resource(name);
};

/**
 * [addRoutes description]
 * @param {[type]} match   [description]
 * @param {Object} routes  Mapping of Method => Function
 * @param {[type]} options [description]
 */
Resource.prototype.addRoute = function (match, route, keys) {
	this.router.addRoute(match, route, keys);
};

/**
 * [addChild description]
 * @param {[type]} resource [description]
 */
Resource.prototype.addChild = function (resource) {
	this.resources[resource.name] = resource;
}

/**
 * [addModel description]
 * @param {[type]} key   [description]
 * @param {[type]} model [description]
 */
Resource.prototype.addModel = function (key, model) {
	this.models[key] = model;
}

/**
 * [route description]
 * @param  {[type]} uri_bundle [description]
 * @param  {[type]} view       [description]
 * @return {[type]}
 */
Resource.prototype.request = function (uri_bundle, view) {
	var key = null;
	var template_dir = this.template_dir;
	var _self = this;

	// Allow direct urls for shorthand. Assume a GET request in this case
	if (typeof uri_bundle === "string") {
		uri_bundle = {
			uri : uri_bundle,
			method : 'GET'
		}
	}

	var route = this.getRoute(uri_bundle);

	if (!route) {
		// attempt each child, see if you can find a proper route
		for (key in this.resources) {
			route = this.resources[key].getRoute(uri_bundle);
			if (route) {
				// ensure that the proper template directory is used within the view
				template_dir = this.resources[key].template_dir;
				break;
			}
		}

		if (!route) {
			route = this.unmatched_route;
		}

		if (!route) {
			// todo: 404
			throw new Error('route not found :' + uri_bundle.uri + ' [' + this.name + ']');
		}
	}

	// If the template provided is actually a server response, we need to build the very first view
	if (view instanceof http_module.ServerResponse) {
		var response = view;

		view = new View();
		view.setRenderMode(accept_header_component.getRenderMode(uri_bundle.headers.accept, route.modes));
		// todo: not sure this will actually be desired due to view template precedence.
		//view.setTemplate(this.default_template);
		view.setResponse(response);
	}

	// If a template is set in the config, apply it to the current view and then provide a child view to the route
	if (!route.options.ignore_template && typeof this.template === "function") {
		// We don't want to set the route resources directory, we will always create the template from the resource upon which request is called
		view.setDir(this.template_dir);
		var child = view.child('content');
		this.template(view);
		view = child;
	}

	// assume that we want to load templates directly from this route, no matter the data provided
	view.setDir(template_dir);

	// route, allowing this to point to the original resource, and provide some helper utils
	if (typeof route[uri_bundle.method] == "function") {
		process.nextTick(function() {
			route[uri_bundle.method].call(_self, uri_bundle, view);
		});
	} else if (typeof route['default'] === "function") {
		process.nextTick(function() {
			route.default.call(_self, uri_bundle, view);
		});
	} else {
		var keys = [];
		['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'].forEach(function (option) {
			if (typeof route[option] === "function") {
				keys.push(option)
			}
		});
		view.unsupportedMethod(keys);
	}
};

/**
 * [getRoute description]
 * @param  {[type]} uri_bundle [description]
 * @return {[type]}
 */
Resource.prototype.getRoute = function (uri_bundle) {

	if (uri_bundle.uri.indexOf(this.uri) === 0) {
		// strip the resource uri out of the request uri
		uri_bundle.uri = uri_bundle.uri.substring(this.uri.length);

		// what to do here? how do I route down into the children?
		// We don't have to pass the view, we can assume it's correct.
		// we just need to make sure that the promise returned is bound to the right resource
		var route = this.router.getRoute(uri_bundle);

		if (route) {
			return route;
		}
	}
	
	// No route was found
	return false;
};

/**
 * 
 * @param router
 * @returns
 * @todo allow users to configure their resource to not take default template or
 *       js or css routes
 */
/*var applyTemplateRoutes = function (router, resource) {
	router.add(new RegExp('^/' + resource.name + '/template/(.+)$'), function (request, response, callback) {
		static_component.streamFile(resource.template_dir + request.GET['template'], response, {
			request : request,
			callback : callback
		});
	}, {keys : ['template']});

	router.add(new RegExp('^/' + resource.name + '/template/(.+)$'), function (request, response, callback) {
		static_component.loadFile(resource.template_dir + request.GET['template'], function (contents) {
			// todo replace this with a chunked renderer like mu?
			var template = hogan_module.compile(contents);
			response.ok(template.render(request.POST));
			callback();

		}, function (error) {
			response.error(error);
			callback();
		});
	}, {method : "POST", keys : ['template']});

	router.add(new RegExp('^/' + resource.name + '(\/.+\.js)$'), function (request, response, callback) {
		var filename = request.GET['file'].replace(/\.\./, '');
		static_component.streamFile(resource.directory + '/templates/js' + filename, response, {
			request : request,
			callback : callback
		});
	}, {keys : ['file']});

	router.add(new RegExp('^/' + resource.name + '(\/.+\.css)$'), function (request, response, callback) {
		var filename = request.GET['file'].replace(/\.\./, '');
		static_component.streamFile(resource.directory + '/templates/css' + filename, response, {
			request : request,
			callback : callback
		});
	}, {keys : ['file']});
};

var applyResourceRoutes = function (router, resource) {
	router.add(new RegExp('^/' + resource.name + '/(\d+)$'), function (request, response, callback) {
		resource.models[resource.name].get({id : request.GET['id']});
	}, {method : "GET", keys : ['id']});

	router.add(new RegExp('^/' + resource.name + '/$'), function (request, response, callback) {
		resource.models[resource.name].get({id : request.GET['id']});
	}, {method : "POST", keys : ['id']});

	router.add(new RegExp('^/' + resource.name + '/(\d+)$'), function (request, response, callback) {
		resource.models[resource.name].save({id : request.GET['id']});
	}, {method : "PUT", keys : ['id']});

	router.add(new RegExp('^/' + resource.name + '/(\d+)$'), function (request, response, callback) {
		resource.models[resource.name].delete({id : request.GET['id']});
	}, {method : "DELETE", keys : ['id']});
};*/
