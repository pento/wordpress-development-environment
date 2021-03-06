// Hazardous overrides some of the functions from "path" to make them work correctly when TestPress is packaged.
require( 'hazardous' );

const yaml = require( 'js-yaml' );
const { copyFileSync, existsSync, renameSync, writeFileSync } = require( 'fs' );
const { spawn } = require( 'promisify-child-process' );
const process = require( 'process' );
const { addAction, didAction } = require( '@wordpress/hooks' );
const sleep = require( 'await-sleep' );
const debug = require( 'debug' )( 'testpress:services:docker' );
const { normalize } = require( 'path' );
const csv = require( 'csvtojson' );

const { TOOLS_DIR } = require( '../constants' );
const { preferences } = require( '../../preferences' );
const { setStatus } = require( '../../utils/status' );

const cwds = {
	'wordpress-folder': '',
	'gutenberg-folder': '',
};
let port = 9999;

const dockerEnv = {};

let USING_TOOLBOX = false;

/**
 * Registers the Docker actions, then starts Docker.
 */
async function registerDockerJob() {
	debug( 'Registering job' );

	if ( 'win32' === process.platform ) {
		USING_TOOLBOX = await detectToolbox();
	}

	addAction( 'preference_saved', 'preferenceSaved', preferenceSaved, 9 );
	addAction( 'shutdown', 'shutdown', shutdown );

	startDocker();
}

/**
 * Get docker up and running.
 */
async function startDocker() {
	if ( USING_TOOLBOX ) {
		await startDockerMachine();
	}

	debug( 'Checking if daemon is running' );
	while ( ! await detectDockerDaemon() ) {
		setStatus( 'docker', 'missing-daemon' );
		await sleep( 1000 );
	}

	debug( 'Preparing to start Docker' );

	setStatus( 'docker', 'starting' );

	cwds[ 'wordpress-folder' ] = preferences.value( 'basic', 'wordpress-folder' );
	cwds[ 'gutenberg-folder' ] = preferences.value( 'basic', 'gutenberg-folder' );

	port = preferences.value( 'site', 'port' ) || 9999;

	if ( ! cwds[ 'wordpress-folder' ] || ! port ) {
		setStatus( 'docker', 'missing-wordpress-folder' );
		debug( 'Bailing, preferences not set' );
		return;
	}

	const defaultOptions = {
		version: '3.7',
		services: {
			'wordpress-develop': {
				image: 'nginx:alpine',
				ports: [
					port + ':80',
				],
				volumes: [
					'./default.conf:/etc/nginx/conf.d/default.conf',
					normalize( cwds[ 'wordpress-folder' ] ) + ':/var/www',
				],
				links: [
					'php',
				],
			},
			php: {
				image: 'garypendergast/wordpress-develop-php',
				volumes: [
					'./php-config.ini:/usr/local/etc/php/conf.d/php-config.ini',
					normalize( cwds[ 'wordpress-folder' ] ) + ':/var/www',
				],
				links: [
					'mysql',
				],
			},
			mysql: {
				image: 'mysql:5.7',
				environment: {
					MYSQL_ROOT_PASSWORD: 'password',
					MYSQL_DATABASE: 'wordpress_develop',
				},
				healthcheck: {
					test: [ 'CMD', 'mysql', '-e', 'SHOW TABLES FROM wordpress_develop', '-uroot', '-ppassword', '-hmysql', '--protocol=tcp' ],
					interval: '1s',
					retries: '100',
				},
				volumes: [
					'mysql:/var/lib/mysql',
				],
			},
		},
		volumes: {
			mysql: {},
		},
	};

	const scriptOptions = {
		version: '3.7',
		services: {
			cli: {
				image: 'wordpress:cli',
				volumes: [
					normalize( cwds[ 'wordpress-folder' ] ) + ':/var/www',
				],
			},
			phpunit: {
				image: 'garypendergast/wordpress-develop-phpunit',
				volumes: [
					'./phpunit-config.ini:/usr/local/etc/php/conf.d/phpunit-config.ini',
					normalize( cwds[ 'wordpress-folder' ] ) + ':/wordpress-develop',
					'phpunit-uploads:/wordpress-develop/src/wp-content/uploads',
				],
				init: true,
			},
		},
		volumes: {
			'phpunit-uploads': {},
		},
	};

	if ( cwds[ 'gutenberg-folder' ] ) {
		const gutenbergVolume = normalize( cwds[ 'gutenberg-folder' ] ) + ':/var/www/src/wp-content/plugins/gutenberg';
		defaultOptions.services[ 'wordpress-develop' ].volumes.push( gutenbergVolume );
		defaultOptions.services.php.volumes.push( gutenbergVolume );

		scriptOptions.services.cli.volumes.push( gutenbergVolume );
		scriptOptions.services[ 'phpunit-gutenberg' ] = {
			image: 'garypendergast/wordpress-develop-phpunit',
			volumes: [
				normalize( cwds[ 'wordpress-folder' ] ) + ':/wordpress-develop',
				normalize( cwds[ 'gutenberg-folder' ] ) + ':/wordpress-develop/src/wp-content/plugins/gutenberg',
			],
		};
	}

	const defaultOptionsYaml = yaml.safeDump( defaultOptions, { lineWidth: -1 } );
	writeFileSync( normalize( TOOLS_DIR + '/docker-compose.yml' ), defaultOptionsYaml );

	const scriptOptionsYaml = yaml.safeDump( scriptOptions, { lineWidth: -1 } );
	writeFileSync( normalize( TOOLS_DIR + '/docker-compose.scripts.yml' ), scriptOptionsYaml );

	copyFileSync( normalize( __dirname + '/default.conf' ), normalize( TOOLS_DIR + '/default.conf' ) );
	copyFileSync( normalize( __dirname + '/php-config.ini' ), normalize( TOOLS_DIR + '/php-config.ini' ) );
	copyFileSync( normalize( __dirname + '/phpunit-config.ini' ), normalize( TOOLS_DIR + '/phpunit-config.ini' ) );

	debug( 'Starting docker containers' );
	await spawn( 'docker-compose', [
		'-f',
		'docker-compose.yml',
		'up',
		'-d',
	], {
		cwd: TOOLS_DIR,
		encoding: 'utf8',
		env: {
			PATH: process.env.PATH,
			...dockerEnv,
		},
	} ).catch( ( { stderr } ) => debug( stderr ) );

	debug( 'Docker containers started' );

	setStatus( 'docker', 'ready' );

	addAction( 'grunt_watch_first_run_finished', 'installWordPress', installWordPress );

	if ( didAction( 'grunt_watch_first_run_finished' ) ) {
		installWordPress();
	}
}

/**
 * When we're using Docker Toolbox, then we need to check that the host machine is up and running.
 */
async function startDockerMachine() {
	debug( 'Starting docker machine' );
	await spawn( 'docker-machine', [
		'start',
		'default',
	], {
		cwd: TOOLS_DIR,
		encoding: 'utf8',
		env: {
			PATH: process.env.PATH,
		},
	} ).catch( ( { stderr } ) => debug( stderr ) );

	const vboxManage = normalize( process.env.VBOX_MSI_INSTALL_PATH + '/VBoxManage' );

	debug( 'Configuring machine port forwarding' );
	await spawn( '"' + vboxManage + '"', [
		'controlvm',
		'"default"',
		'natpf1',
		'delete',
		'wphttp',
	], {
		cwd: TOOLS_DIR,
		encoding: 'utf8',
		env: {
			PATH: process.env.PATH,
		},
		shell: true,
	} ).catch( ( { stderr } ) => debug( stderr ) );

	await spawn( '"' + vboxManage + '"', [
		'controlvm',
		'"default"',
		'natpf1',
		'wphttp,tcp,127.0.0.1,' + port + ',,' + port,
	], {
		cwd: TOOLS_DIR,
		encoding: 'utf8',
		env: {
			PATH: process.env.PATH,
		},
		shell: true,
	} ).catch( ( { stderr } ) => debug( stderr ) );

	debug( 'Collecting docker environment info' );
	await spawn( 'docker-machine', [
		'env',
		'default',
		'--shell',
		'cmd',
	], {
		cwd: TOOLS_DIR,
		encoding: 'utf8',
		env: {
			PATH: process.env.PATH,
		},
	} )
		.then( ( { stdout } ) => {
			stdout.split( '\n' ).forEach( ( line ) => {
				// Environment info is in the form: SET ENV_VAR=value
				if ( ! line.startsWith( 'SET' ) ) {
					return;
				}

				const parts = line.trim().split( /[ =]/, 3 );
				if ( 3 === parts.length ) {
					dockerEnv[ parts[ 1 ] ] = parts[ 2 ];
				}
			} );

			debug( 'Docker environment: %O', dockerEnv );
		} )
		.catch( ( { stderr } ) => debug( stderr ) );
}

/**
 * Runs the WP-CLI commands to install WordPress.
 */
async function installWordPress() {
	setStatus( 'wordpress', 'installing' );

	debug( 'Waiting for mysqld to start in the MySQL container' );
	while ( 1 ) {
		const { stdout } = await spawn( 'docker', [
			'inspect',
			'--format',
			'{{json .State.Health.Status }}',
			'tools_mysql_1',
		], {
			cwd: TOOLS_DIR,
			encoding: 'utf8',
			env: {
				PATH: process.env.PATH,
				...dockerEnv,
			},
		} );

		if ( stdout.trim() === '"healthy"' ) {
			break;
		}

		await sleep( 1000 );
	}

	debug( 'Checking if a config file exists' );
	const configExists = await runCLICommand( 'config', 'path' );
	if ( ! configExists ) {
		debug( 'Creating wp-config.php file' );
		await runCLICommand( 'config',
			'create',
			'--dbname=wordpress_develop',
			'--dbuser=root',
			'--dbpass=password',
			'--dbhost=mysql',
			'--path=/var/www/build' );

		if ( existsSync( normalize( cwds[ 'wordpress-folder' ] + '/build/wp-config.php' ) ) ) {
			debug( 'Moving wp-config.php out of the build directory' );
			renameSync(
				normalize( cwds[ 'wordpress-folder' ] + '/build/wp-config.php' ),
				normalize( cwds[ 'wordpress-folder' ] + '/wp-config.php' )
			);
		}

		debug( 'Adding debug options to wp-config.php' );
		await runCLICommand( 'config', 'set', 'WP_DEBUG', 'true', '--raw', '--type=constant' );
		await runCLICommand( 'config', 'set', 'SCRIPT_DEBUG', 'true', '--raw', '--type=constant' );
		await runCLICommand( 'config', 'set', 'WP_DEBUG_DISPLAY', 'true', '--raw', '--type=constant' );
	}

	debug( 'Checking if WordPress is installed' );
	const isInstalled = await runCLICommand( 'core', 'is-installed' );
	if ( isInstalled ) {
		debug( 'Updating site URL' );
		await runCLICommand( 'option', 'update', 'home', 'http://localhost:' + port );
		await runCLICommand( 'option', 'update', 'siteurl', 'http://localhost:' + port );
	} else {
		debug( 'Installing WordPress' );
		await runCLICommand( 'core',
			'install',
			'--url=localhost:' + port,
			'--title=WordPress Develop',
			'--admin_user=admin',
			'--admin_password=password',
			'--admin_email=test@test.test',
			'--skip-email' );
	}

	setStatus( 'wordpress', 'ready' );

	debug( 'WordPress ready at http://localhost:%d/', port );
}

/**
 * Spawns a process to run a WP-CLI command in a Docker container.
 *
 * @param {...string} args The WP-CLI command and arguments to be run.
 *
 * @return {Promise} Promise that resolves to true if the command succeeded, false if it failed.
 */
function runCLICommand( ...args ) {
	return spawn( 'docker-compose', [
		'-f',
		'docker-compose.yml',
		'-f',
		'docker-compose.scripts.yml',
		'run',
		'--rm',
		'cli',
		...args,
	], {
		cwd: TOOLS_DIR,
		encoding: 'utf8',
		env: {
			PATH: process.env.PATH,
			...dockerEnv,
		},
	} )
		.then( () => true )
		.catch( ( { stderr } ) => {
			debug( stderr.trim() );
			return false;
		} );
}

/**
 * Figure out if the Docker daemon is running. No daemon implies that the user
 * needs to install and/or open Docker.
 *
 * @return {boolean} true if the Docker daemon is running, false if it isn't.
 */
async function detectDockerDaemon() {
	try {
		await spawn( 'docker', [ 'info' ] );
		return true;
	} catch {
		return false;
	}
}

/**
 * Figure out if we're using Docker Toolbox or not. Uses Docker for Windows' version and Hyper-V
 * requirements as a baseline to determine whether Toolbox is being used.
 *
 * @return {boolean} true if Docker Toolbox is being used, false if it isn't.
 */
async function detectToolbox() {
	debug( 'Detecting if we should use Docker Toolbox or not' );
	return await spawn( 'systeminfo', [
		'/FO',
		'CSV',
	], {
		encoding: 'utf8',
		env: {
			PATH: process.env.PATH,
		},
	} )
		.then( ( { stdout } ) => csv().fromString( stdout ) )
		.then( ( info ) => {
			if ( ! info[ 0 ][ 'OS Name' ].includes( 'Pro' ) ) {
				debug( 'Not running Windows Pro' );
				return true;
			}

			if ( info[ 0 ][ 'OS Version' ].match( /^\d+/ )[ 0 ] < 10 ) {
				debug( 'Not running Windows 10' );
				return true;
			}

			if ( info[ 'OS Version' ].match( /\d+$/ )[ 0 ] < 14393 ) {
				debug( 'Not running build 14393 or later' );
				return true;
			}

			const hyperv = info[ 0 ][ 'Hyper-V Requirements' ].split( ',' );

			return hyperv.reduce( ( allowed, line ) => {
				const [ requirement, enabled ] = line.split( ':' ).map( ( val ) => val.trim().toLowerCase() );
				if ( 'yes' !== enabled ) {
					debug( "Don't have Hyper-V requirement \"%s\" available", requirement );
					return false;
				}
				return allowed;
			}, true );
		} )
		.catch( ( { stderr } ) => {
			debug( stderr );
			return false;
		} );
}

/**
 * Action handler for when preferences have been saved.
 *
 * @param {string} section    The preferences section that the saved preference is in.
 * @param {string} preference The preferences that has been saved.
 * @param {*}      value      The value that the preference has been changed to.
 */
async function preferenceSaved( section, preference, value ) {
	let changed = false;

	if ( section === 'basic' && preference === 'wordpress-folder' && value !== cwds[ 'wordpress-folder' ] ) {
		changed = true;
	}

	if ( section === 'basic' && preference === 'gutenberg-folder' && value !== cwds[ 'gutenberg-folder' ] ) {
		changed = true;
	}

	if ( section === 'site' && preference === 'port' && value !== port ) {
		changed = true;
	}

	if ( ! changed ) {
		return;
	}

	debug( 'Preferences updated' );

	if ( existsSync( normalize( TOOLS_DIR + '/docker-compose.yml' ) ) ) {
		debug( 'Stopping containers' );
		await spawn( 'docker-compose', [
			'-f',
			'docker-compose.yml',
			'down',
		], {
			cwd: TOOLS_DIR,
			encoding: 'utf8',
			env: {
				PATH: process.env.PATH,
				...dockerEnv,
			},
		} );
	}

	startDocker();
}

/**
 * Shutdown handler, to ensure the docker containers are shut down cleanly.
 */
function shutdown() {
	debug( 'Shutdown, stopping containers' );
	spawn( 'docker-compose', [
		'-f',
		'docker-compose.yml',
		'down',
	], {
		cwd: TOOLS_DIR,
		detached: true,
		encoding: 'utf8',
		env: {
			PATH: process.env.PATH,
			...dockerEnv,
		},
		stdio: [ 'ignore', 'ignore', 'ignore' ],
	} );
}

module.exports = {
	registerDockerJob,
};
