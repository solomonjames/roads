/*
* gfw.js - view.js
* Copyright(c) 2011 Aaron Hedges <aaron@dashron.com>
* MIT Licensed
*/
"use strict";

var mu = require('mu2');
mu.root = '/';

var EventEmitter = require('events').EventEmitter;
var util_module = require('util');
var http_module = require('http');
var fs_module = require('fs');

var _renderers = {};

/**
 * [addRenderer description]
 * @param {[type]} content_type [description]
 * @param {[type]} renderer     [description] 
 */
exports.addRenderer = function (content_type, renderer) {
	_renderers[content_type] = renderer;
};

/**
 * [getRenderer description]
 * @param  {[type]} content_type [description]
 * @return {[type]}              [description]
 */
exports.getRenderer = function (content_type) {
	if (_renderers[content_type]) {
		return _renderers[content_type];
	} else {
		throw new Error('Unsupported content type :' + content_type);
	}
}
/**
 * Renders templates asynchronously, supporing an unlimited amount of child views.
 * 
 * USAGE:
 * //Templates:
 * templates/index.html
 * <html>
 *  <head></head>
 *  <body>
 *   {{{header}}}
 *  </body>
 * </html>
 * 
 * templates/header.html
 * <header>
 * {{title}}
 * </header>
 * 
 * 
 * //Create the parent:
 * var template = new View("templates/index.html");
 * template.setResponse(response)
 * 
 * //Create the child:
 * var child = template.child("header", "templates/header.html");
 * child.title = "Hello World";
 * 
 * //Write the view to the response
 * template.render();
 * 
 * //And you are done! You don't have to tell the child views to render, that is all handled for you.
 * //The final rendered contents of Child will be rendered in template's "header" tag, so make sure you use raw data and don't escape it
 * //If you want to use the js or css functions, you need to 
 * 
 * @author Aaron Hedges <aaron@dashron.com>
 */
var View = exports.View = function View() {
	EventEmitter.call(this);
	this._js = {};
	this._css = {};

	this._child_views = {};
	this._data = {};

	this.render_state = this.RENDER_NOT_CALLED;
	this.parent = null;
	this.root = this;
	// Default error handler 500's
	// This is problematic. If response.end() errors, it ends up in a crazy ass loop.
	/*this._error_handler = function (error) {
		console.log(error);
		this.error(error);
	}*/
};

util_module.inherits(View, EventEmitter);

View.prototype._js = null;
View.prototype._css = null;
View.prototype._dir = null;
View.prototype._template = null;
View.prototype._response = null;
View.prototype._data = null;
View.prototype._child_views = null;
View.prototype._render_mode = null;
View.prototype._error_handler = null;
View.prototype.render_state = 0;
// TODO: Move these constants into the module? not the class?
View.prototype.RENDER_NOT_CALLED = 0;
View.prototype.RENDER_REQUESTED = 1;
View.prototype.RENDER_STARTED = 2;
View.prototype.RENDER_COMPLETE = 3;
View.prototype.RENDER_FAILED = 4;
View.prototype.parent = null;
View.prototype.root = null;

/**
 * Set the directory this view will be loaded from
 * @param {String} path
 */
View.prototype.setDir = function view_setDir(path) {
	this._dir = path;
	return this;
};

/**
 * [getDir description]
 * @return {[type]} [description]
 */
View.prototype.getDir = function view_getDir() {
	return this._dir;
};

/**
 * [setResponse description]
 * @param {[type]} response [description]
 */
View.prototype.setResponse = function view_setResponse(response) {
	if (response instanceof http_module.ServerResponse) {
		response.setHeader('Content-Type', 'text/plain');
		response.status_code = 200;
	}

	this._response = response;

	return this;
}

/**
 * [setRenderMode description]
 * @param {[type]} mode [description]
 */
View.prototype.setRenderMode = function view_setRenderMode(mode) {
	this._render_mode = mode;
}

/**
 * [setTemplate description]
 * @type {[type]}
 */
View.prototype.setTemplate = function view_setTemplate(template) {
	this._template = template;
};

/**
 * returns whether the view has finished rendering or not
 * @returns {Boolean}
 */
View.prototype.isRendered = function view_isRendered() {
	return this.render_state == this.RENDER_COMPLETE;
};

/**
 * Sets data to be rendered to the view
 * @param {String} key
 * @param {Mixed} value
 */
View.prototype.set = function view_set(key, value) {
	this._data[key] = value;
};

/**
 * Sets data to be rendered by the root template (eg page title)
 * @param {[type]} title [description]
 */
View.prototype.setToRoot = function view_setToRoot(key, value) {
	this.root.set(key, value);
};

/**
 * Retrieves all of the data so that it can be rendered by a parent
 * @param {String} key
 * @return {Mixed|Object}
 */
View.prototype.get = function view_get(key) {
	if(typeof key === "string") {
		return this._data[key];
	}
	return this._data;
};

/**
 * Executes the provided function, and adds all the keys in the returned object
 * to the data which will be rendered in this view
 * @TODO: Only call func when render is executed
 * @param {Function} func
 */
View.prototype.fill = function view_fill(func) {
	var new_data = func();
	var i = null;
	for(i in new_data) {
		this._data[i] = new_data[i];
	}
};

/**
 * If the view is ready to be rendered, this will be true, otherwise false
 * @returns {Boolean}
 */
View.prototype.canRender = function view_canRender() {
	var key = null;

	/**
	 * This protects from items rendering in random async order
	 * example 1:
	 * parent creates child, loads data from database, then renders.
	 * child immediately renders
	 * - in this example, the child is complete first, and checks if the parent can render.
	 *    Render has not been requested, so it fails. Once the parent calls render everything works fine
	 * 
	 * example 2:
	 * Parent creates child, then immediately renders
	 * child loads data from database then renders.
	 * - in this example, the parent is complete first, so it marks render as requested but notices child views exist
	 *    Because of this, it waits. Once the child view renders it notices that the parent is ready and immediately calls parent.render
	 */  
	if (this.render_state != this.RENDER_REQUESTED) {
		return false;
	}

	for(key in this._child_views) { 
		if(!this._child_views[key].isRendered()) {
			return false;
		}
	}
	return true;
};

/**
 * Renders the current view, writing the the response, if and only if all child views have been completed
 * @todo: handle the case where a child element never finishes
 * @param  {String|Boolean} template Renders the provided template unless one was set previously. If false is passed, no data will be written
 * @return {[type]}          [description]
 */
View.prototype.render = function view_render(template) {
	if (template !== false) {
		this.render_state = this.RENDER_REQUESTED;

		if (this.canRender()) {
			this.render_state = this.RENDER_STARTED;
			// We want to prefer the pre-set template over the render(template)
			if (this._template) {
				template = this._template;
			}
			this.buildTemplateEngine().render(this._dir + template);
		} else {
			// If a template has not yet been assigned to this view, and we can not immediately render it
			// we need to set the provided template, so it is rendered in the future
			if (!this._template) {
				this.setTemplate(template);
			}
		}
	} else {
		this._response.end();
	}
};

/**
 * [buildTemplateEngine description]
 * @return {[type]} [description]
 */
View.prototype.buildTemplateEngine = function view_buildTemplateEngine() {
	var _self = this;

	var template_engine = new (exports.getRenderer(this._render_mode))();
	template_engine.data = this._data;
	template_engine.response = this._response;
	template_engine.errorHandler(function (error) {
		_self.render_state = this.RENDER_FAILED;
		_self._error_handler(error);
	});
	template_engine.endHandler(function() {
		_self.render_state = _self.RENDER_COMPLETE;
	});
	return template_engine;
};


/**
 * [errorHandler description]
 * @param  {Function} fn [description]
 * @return {[type]}      [description]
 */
View.prototype.setErrorHandler = function view_setErrorHandler(fn) {
	this._error_handler = fn;
}


/**
 * Create a child view
 * @param {String} key required, the key the parent will render the data in
 * @param {String} template required, the template file to be rendered
 * @returns {View}
 */
View.prototype.child = function view_child(key, template) {
	var new_view = new View();
	new_view.setRenderMode(this._render_mode);
	new_view.parent = this;
	new_view.root = this.root;
	new_view.setDir(this._dir);

	// Makes a fake response that writes to the parent instead of to an actual response object
	new_view.setResponse({
		buffer: '',
		write: function(chunk) {
			this.buffer += chunk; 
		},
		end: function() { 
			// flag the child view as rendered
			new_view.render_state = new_view.RENDER_COMPLETE;

			// set the child data into the parent view, and then render the parent if possible
			new_view.parent.set(key, this.buffer); 

			if(new_view.parent.canRender()) {
				process.nextTick(function() {
					new_view.parent.render(template);
				});
			}
		}
	 });

	this._child_views[key] = new_view;

	return this._child_views[key];
};

/**
 * Adds a javascript file, and pushes it all the way up the chain to the core template
 * TODO: add a flag so it is not pushed to the top? is that useful?
 * @param {String} file 
 */
View.prototype.addJs = function view_addJs(file) {
	this.root._js.push({'src' : file});
};

/**
 * Adds a css file, and pushes it all the way up the chain to the core template
 * TODO: add a flag so it is not pushed to the top? is that useful?
 * @param {String} file
 */
View.prototype.addCss = function view_addCss(file) {
	this.root._css.push({'src' : file})
};

/**
 * Set the response status code in the response tied to the parent most view
 * @param {[type]} code [description]
 */
View.prototype.setStatusCode = function view_setStatusCode(code) {
	this.root._response.statusCode = code;
};

/**
 * Set a collection of headers in the response tied to the parent most view
 * @param {[type]} headers [description]
 */
View.prototype.setHeader = function view_setHeaders(headers) {
	var key = null;
	for(key in headers) {
		this.root._response.setHeader(key, headers[key]);
	}
};

/**
 * Return a 404: Not found code, and overwrite the existing template with the one provided
 * @param  {[type]} template [description]
 * @return {[type]}
 * @todo  fix
 */
View.prototype.notFound = function view_notFound(template) {
	this.root._response.statusCode = 404;
	this.root._render(template);
};

/**
 * Return a 500: Error code, and overwrite the existing tempalte with the one provided
 * @param  {[type]} template [description]
 * @return {[type]}
 */
View.prototype.error = function view_error(error) {
	this.root._response.statusCode = 500;
	this.root.render(false);
};

/**
 * Return a 201: Created code, and redirect the user to the provided url
 * 
 * @todo describe how this would be properly used
 * @param  {[type]} redirect_url [description]
 * @return {[type]}
 */
View.prototype.created = function view_created(redirect_url) {
	this.root._response.statusCode = 201;
	this.root._response.setHeader('Location', redirect_url);
	this.root.render(false);
};

/**
 * Return a 302: Found code, 
 * @todo  add support for other 300's
 * @todo describe how this would be properly used
 * @param  {[type]} redirect_url [description]
 * @return {[type]}
 */
View.prototype.redirect = function view_redirect(redirect_url) {
	this.root._response.statusCode = 302;
	this.root._response.setHeader('Location', redirect_url);
	this.root.render(false);
};

/**
 * [notModified description]
 * @return {[type]} [description]
 */
View.prototype.notModified = function view_notModified() {
	this.root._response.statusCode = 304;
	// date
	// etag
	// expires
	// cache  control
	this.root.render(false);
};

View.prototype.unsupportedMethod = function view_unsupportedMethod(supported_methods) {
	this.root._response.statusCode = 405
	this.root._response.setHeader('Allow', supported_methods.join(','));
	this.root._response.end();
};

/**
 * [Renderer description]
 */
var Renderer = exports.Renderer = function() {
	this.response = {};
	this.data = {};
};

Renderer.prototype.response = null;
Renderer.prototype.data = null;

/**
 * [error description]
 * @param  {[type]} err [description]
 * @return {[type]}
 */
Renderer.prototype.error = function (err) {
	// In case the error is called before the error handler is applied, we mess with the function so we still get output
	this.errorHandler = function (fn) {
		fn(err);
	};
};

Renderer.prototype.end = function () {
	this.endHandler = function (fn) {
		fn();
	};
};

/**
 * [errorHandler description]
 * @param  {Function} fn [description]
 * @return {[type]}
 */
Renderer.prototype.errorHandler = function (fn) {
	this.error = fn;
};

/**
 * [endHandler description]
 * @return {[type]} [description]
 */
Renderer.prototype.endHandler = function (fn) {
	this.end = fn;
};

/**
 * [HtmlRenderer description]
 * @param {[type]} template [description]
 */
var HtmlRenderer = function() {
	Renderer.call(this);
};
util_module.inherits(HtmlRenderer, Renderer);

/**
 * [render description]
 * @param  {[type]} template [description]
 * @return {[type]}
 */
HtmlRenderer.prototype.render = function (template) {
	var _self = this;

	if (this.response instanceof http_module.ServerResponse) {
		this.response.setHeader('Content-Type', 'text/html');
		this.response.status_code = 200;
	}

	var stream = mu.compileAndRender(template, this.data);
	stream.on('data', function (data) {
		_self.response.write(data);
	});

	stream.on('error', function (err) {
		_self.error(err);
	});

	stream.on('end', function () {
		_self.end();
		_self.response.end();
	});
};
exports.addRenderer('text/html', HtmlRenderer);

/**
 * [JsonRenderer description]
 */
var JsonRenderer = function() {
	Renderer.call(this);
};

util_module.inherits(JsonRenderer, Renderer);

/**
 * [render description]
 * @return {[type]}
 */
JsonRenderer.prototype.render = function () {
	if (this.response instanceof http_module.ServerResponse) {
		this.response.setHeader('Content-Type', 'application/json');
		this.response.status_code = 200;
	}

	this.response.write(JSON.stringify(this.data));
	this.response.end();
};
exports.addRenderer('application/json', JsonRenderer);


var buildFileRenderer = function (content_type) {
	var FileRenderer = function() {
		Renderer.call(this);
	}

	util_module.inherits(FileRenderer, Renderer);

	FileRenderer.prototype.render = function (template) {
		var _self = this;

		if (this.response instanceof http_module.ServerResponse) {
			this.response.setHeader('Content-Type', content_type)
			this.response.status_code = 200;
		}

		var stream = fs_module.createReadStream(template);
		stream.on('data', function (data) {
			_self.response.write(data);
		});

		stream.on('error', function (err) {
			_self.error(err);
		});

		stream.on('end', function () {
			_self.response.end();
		});
	}

	return FileRenderer;
}

exports.addRenderer('text/css', buildFileRenderer('text/css'));
exports.addRenderer('text/javascript', buildFileRenderer('text/javascript'));
