/**
 * External dependencies
 */
import React, { Component } from 'react';
import { CSSTransition } from 'react-transition-group';

/**
 * WordPress dependencies
 */
import { IconButton } from '@wordpress/components';

/**
 * Internal dependencies
 */
import PreferencesButton from '../preferences-button';

import './style.scss';

class Pages extends Component {
	constructor() {
		super( ...arguments );

		this.state = {
			activePage: 0,
		};

		this.setActivePage = this.setActivePage.bind( this );
	}

	setActivePage( activePage ) {
		this.setState( { activePage } );
	}

	render() {
		const { pages } = this.props;
		const { activePage } = this.state;

		return (
			<div className="pages">
				{
					pages.map( ( page, index ) => (
						<CSSTransition
							in={ index && index === activePage ? true : false }
							timeout={ 300 }
							key={ 'page' + index }
							classNames="pages__page-transition"
						>
							{ () => (
								<div className={ 'pages__page page' + index }>
									<header className="pages__page-header">
										<svg className="pages__page-title-logo" xmlns="http://www.w3.org/2000/svg" fillRule="evenodd" version="1.0" viewBox="0 0 5.5555557 5.5555555">
											<g transform="matrix(1.0755 0 0 1.0755 -3.5103 -1.6684)">
												<path d="m5.8465 1.9131c0.57932 0 1.1068 0.222 1.5022 0.58547-0.1938-0.0052-0.3872 0.11-0.3952 0.3738-0.0163 0.5333 0.6377 0.6469 0.2853 1.7196l-0.2915 0.8873-0.7939-2.3386c-0.0123-0.0362 0.002-0.0568 0.0465-0.0568h0.22445c0.011665 0 0.021201-0.00996 0.021201-0.022158v-0.13294c0-0.012193-0.00956-0.022657-0.021201-0.022153-0.42505 0.018587-0.8476 0.018713-1.2676 0-0.0117-0.0005-0.0212 0.01-0.0212 0.0222v0.13294c0 0.012185 0.00954 0.022158 0.021201 0.022158h0.22568c0.050201 0 0.064256 0.016728 0.076091 0.049087l0.3262 0.8921-0.4907 1.4817-0.8066-2.3758c-0.01-0.0298 0.0021-0.0471 0.0308-0.0471h0.25715c0.011661 0 0.021197-0.00996 0.021197-0.022158v-0.13294c0-0.012193-0.00957-0.022764-0.021197-0.022153-0.2698 0.014331-0.54063 0.017213-0.79291 0.019803 0.39589-0.60984 1.0828-1.0134 1.8639-1.0134l-0.0000029-0.0000062zm1.9532 1.1633c0.17065 0.31441 0.26755 0.67464 0.26755 1.0574 0 0.84005-0.46675 1.5712-1.1549 1.9486l0.6926-1.9617c0.1073-0.3036 0.2069-0.7139 0.1947-1.0443h-0.000004zm-1.2097 3.1504c-0.2325 0.0827-0.4827 0.1278-0.7435 0.1278-0.2247 0-0.4415-0.0335-0.6459-0.0955l0.68415-1.9606 0.70524 1.9284v-1e-7zm-1.6938-0.0854c-0.75101-0.35617-1.2705-1.1213-1.2705-2.0075 0-0.32852 0.071465-0.64038 0.19955-0.92096l1.071 2.9285 0.000003-0.000003zm0.95023-4.4367c1.3413 0 2.4291 1.0878 2.4291 2.4291s-1.0878 2.4291-2.4291 2.4291-2.4291-1.0878-2.4291-2.4291 1.0878-2.4291 2.4291-2.4291zm0-0.15354c1.4261 0 2.5827 1.1566 2.5827 2.5827s-1.1566 2.5827-2.5827 2.5827-2.5827-1.1566-2.5827-2.5827 1.1566-2.5827 2.5827-2.5827z" />
											</g>
										</svg>
										<h1 className="pages__page-title">
											{ page.heading }
										</h1>
										{ activePage === 0 &&
											<IconButton
												className="pages__page-patching-button"
												onClick={ () => this.setActivePage( 3 ) }
												icon="editor-code"
												label="Apply and upload patches"
											/>
										}
										<PreferencesButton
											activePage={ activePage }
											setActivePage={ this.setActivePage }
										/>
									</header>
									{ page.panel }
								</div>
							) }
						</CSSTransition>
					) )
				}
			</div>
		);
	}
}

export default Pages;
