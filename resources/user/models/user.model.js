var model_module = require(__dirname.replace('/resources/user/models', '/components/model'));

var crypto_module = require('crypto');


var UserModule = module.exports = new model_module.ModelModule();
UserModule.connection = 'default';
UserModule.setModel({
        table : 'user',
        fields : {
                id : {
                        type : 'id',
                },
                email : {
                        type : 'email'
                },
                password : {
                        type : 'password',
						set : function (password) {
							this.password = crypto_module.createHash('sha256').update(password).digest('hex');
						}
                },
                last_ip : {
                        type : 'ip',
                }
        },
        methods : {
			checkPassword : function checkPassword(password) {
				var sha256 = crypto_module.createHash('sha256').update(password);
				return sha256.digest('hex') === this.password;
			}
        }
});