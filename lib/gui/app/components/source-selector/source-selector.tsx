/*
 * Copyright 2016 balena.io
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
	faFile,
	faLink,
	faExclamationTriangle,
	faCopy,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { sourceDestination, scanner } from 'etcher-sdk';
import { ipcRenderer, IpcRendererEvent } from 'electron';
import * as _ from 'lodash';
import { GPTPartition, MBRPartition } from 'partitioninfo';
import * as path from 'path';
import * as React from 'react';
import {
	ButtonProps,
	Card as BaseCard,
	Input,
	Modal as SmallModal,
	Txt,
	Flex,
} from 'rendition';
import styled from 'styled-components';

import * as errors from '../../../../shared/errors';
import * as messages from '../../../../shared/messages';
import * as supportedFormats from '../../../../shared/supported-formats';
import * as shared from '../../../../shared/units';
import * as selectionState from '../../models/selection-state';
import { observe } from '../../models/store';
import * as analytics from '../../modules/analytics';
import * as exceptionReporter from '../../modules/exception-reporter';
import * as osDialog from '../../os/dialog';
import { replaceWindowsNetworkDriveLetter } from '../../os/windows-network-drives';
import {
	ChangeButton,
	DetailsText,
	Modal,
	StepButton,
	StepNameButton,
} from '../../styled-components';
import { colors } from '../../theme';
import { middleEllipsis } from '../../utils/middle-ellipsis';
import { SVGIcon } from '../svg-icon/svg-icon';

import ImageSvg from '../../../assets/image.svg';
import { DriveSelector } from '../drive-selector/drive-selector';

const recentUrlImagesKey = 'recentUrlImages';

function normalizeRecentUrlImages(urls: any): string[] {
	if (!Array.isArray(urls)) {
		urls = [];
	}
	return _.chain(urls)
		.filter(_.isString)
		.reject(_.isEmpty)
		.uniq()
		.takeRight(5)
		.value();
}

function getRecentUrlImages(): string[] {
	let urls = [];
	try {
		urls = JSON.parse(localStorage.getItem(recentUrlImagesKey) || '[]');
	} catch {
		// noop
	}
	return normalizeRecentUrlImages(urls);
}

function setRecentUrlImages(urls: string[]) {
	localStorage.setItem(
		recentUrlImagesKey,
		JSON.stringify(normalizeRecentUrlImages(urls)),
	);
}

const Card = styled(BaseCard)`
	hr {
		margin: 5px 0;
	}
`;

// TODO move these styles to rendition
const ModalText = styled.p`
	a {
		color: rgb(0, 174, 239);

		&:hover {
			color: rgb(0, 139, 191);
		}
	}
`;

function getState() {
	return {
		hasImage: selectionState.hasImage(),
		imageName: selectionState.getImageName(),
		imageSize: selectionState.getImageSize(),
	};
}

const URLSelector = ({
	done,
	cancel,
}: {
	done: (imageURL: string) => void;
	cancel: () => void;
}) => {
	const [imageURL, setImageURL] = React.useState('');
	const [recentImages, setRecentImages]: [
		string[],
		(value: React.SetStateAction<string[]>) => void,
	] = React.useState([]);
	const [loading, setLoading] = React.useState(false);
	React.useEffect(() => {
		const fetchRecentUrlImages = async () => {
			const recentUrlImages: string[] = await getRecentUrlImages();
			setRecentImages(recentUrlImages);
		};
		fetchRecentUrlImages();
	}, []);
	return (
		<Modal
			cancel={cancel}
			primaryButtonProps={{
				disabled: loading || !imageURL,
			}}
			done={async () => {
				setLoading(true);
				const sanitizedRecentUrls = normalizeRecentUrlImages([
					...recentImages,
					imageURL,
				]);
				setRecentUrlImages(sanitizedRecentUrls);
				await done(imageURL);
			}}
		>
			<Flex style={{ width: '100%' }} flexDirection="column">
				<Txt mb="10px" fontSize="24px">
					Use Image URL
				</Txt>
				<Input
					value={imageURL}
					placeholder="Enter a valid URL"
					type="text"
					onChange={(evt: React.ChangeEvent<HTMLInputElement>) =>
						setImageURL(evt.target.value)
					}
				/>
			</Flex>
			{!_.isEmpty(recentImages) && (
				<Flex flexDirection="column">
					<Txt fontSize={18}>Recent</Txt>
					<Card
						style={{ padding: '10px 15px' }}
						rows={_.map(recentImages, (recent) => (
							<Txt
								key={recent}
								onClick={() => {
									setImageURL(recent);
								}}
							>
								<span>
									{_.last(_.split(recent, '/'))} - {recent}
								</span>
							</Txt>
						))}
					/>
				</Flex>
			)}
		</Modal>
	);
};

interface Flow {
	icon?: JSX.Element;
	onClick: (evt: React.MouseEvent) => void;
	label: string;
}

const FlowSelector = styled(
	({ flow, ...props }: { flow: Flow; props?: ButtonProps }) => {
		return (
			<StepButton
				plain
				onClick={(evt) => flow.onClick(evt)}
				icon={flow.icon}
				{...props}
			>
				{flow.label}
			</StepButton>
		);
	},
)`
	border-radius: 24px;
	color: rgba(255, 255, 255, 0.7);

	:enabled:hover {
		background-color: ${colors.primary.background};
		color: ${colors.primary.foreground};
		font-weight: 600;

		svg {
			color: ${colors.primary.foreground}!important;
		}
	}
`;

export type Source =
	| typeof sourceDestination.File
	| typeof sourceDestination.BlockDevice
	| typeof sourceDestination.Http;

export interface SourceMetadata extends sourceDestination.Metadata {
	hasMBR: boolean;
	partitions: MBRPartition[] | GPTPartition[];
	path: string;
	extension?: string;
}
export interface SourceOptions {
	imagePath: string;
	SourceType: Source;
}

interface SourceSelectorProps {
	flashing: boolean;
	afterSelected: (options: SourceOptions) => void;
}

interface SourceSelectorState {
	hasImage: boolean;
	imageName: string;
	imageSize: number;
	warning: { message: string; title: string | null } | null;
	showImageDetails: boolean;
	showURLSelector: boolean;
	showDriveSelector: boolean;
}

export class SourceSelector extends React.Component<
	SourceSelectorProps,
	SourceSelectorState
> {
	private unsubscribe: () => void;

	constructor(props: SourceSelectorProps) {
		super(props);
		this.state = {
			...getState(),
			warning: null,
			showImageDetails: false,
			showURLSelector: false,
			showDriveSelector: false,
		};
	}

	public componentDidMount() {
		this.unsubscribe = observe(() => {
			this.setState(getState());
		});
		ipcRenderer.on('select-image', this.onSelectImage);
		ipcRenderer.send('source-selector-ready');
	}

	public componentWillUnmount() {
		this.unsubscribe();
		ipcRenderer.removeListener('select-image', this.onSelectImage);
	}

	private async onSelectImage(_event: IpcRendererEvent, imagePath: string) {
		const isURL =
			_.startsWith(imagePath, 'https://') || _.startsWith(imagePath, 'http://');
		await this.selectImageByPath({
			imagePath,
			SourceType: isURL ? sourceDestination.Http : sourceDestination.File,
		});
	}

	private reselectImage() {
		analytics.logEvent('Reselect image', {
			previousImage: selectionState.getImage(),
		});

		selectionState.deselectImage();
	}

	private selectImage(image: SourceMetadata) {
		try {
			let message = null;
			let title = null;

			if (supportedFormats.looksLikeWindowsImage(image.path)) {
				analytics.logEvent('Possibly Windows image', { image });
				message = messages.warning.looksLikeWindowsImage();
				title = 'Possible Windows image detected';
			} else if (!image.hasMBR) {
				analytics.logEvent('Missing partition table', { image });
				title = 'Missing partition table';
				message = messages.warning.missingPartitionTable();
			}

			if (message) {
				this.setState({
					warning: {
						message,
						title,
					},
				});
			}

			selectionState.selectImage(image);
			analytics.logEvent('Select image', {
				// An easy way so we can quickly identify if we're making use of
				// certain features without printing pages of text to DevTools.
				image: {
					...image,
					logo: Boolean(image.logo),
					blockMap: Boolean(image.blockMap),
				},
			});
		} catch (error) {
			exceptionReporter.report(error);
		}
	}

	private async selectImageByPath({ imagePath, SourceType }: SourceOptions) {
		try {
			imagePath = await replaceWindowsNetworkDriveLetter(imagePath);
		} catch (error) {
			analytics.logException(error);
		}

		let source;
		if (SourceType === sourceDestination.File) {
			source = new sourceDestination.File({
				path: imagePath,
			});
		} else {
			if (
				!_.startsWith(imagePath, 'https://') &&
				!_.startsWith(imagePath, 'http://')
			) {
				const invalidImageError = errors.createUserError({
					title: 'Unsupported protocol',
					description: messages.error.unsupportedProtocol(),
				});

				osDialog.showError(invalidImageError);
				analytics.logEvent('Unsupported protocol', { path: imagePath });
				return;
			}
			source = new sourceDestination.Http({ url: imagePath });
		}

		try {
			const innerSource = await source.getInnerSource();
			const metadata = await this.getMetadata(innerSource, imagePath);
			metadata.extension = path.extname(imagePath).slice(1);
			this.selectImage(metadata);
			this.props.afterSelected({
				imagePath,
				SourceType,
			});
		} catch (error) {
			this.handleError('Error opening image', path.basename(imagePath), error);
		} finally {
			try {
				await source.close();
			} catch (error) {
				// Noop
			}
		}
	}

	private handleError(title: string, sourcePath: string, error: any) {
		const imageError = errors.createUserError({
			title,
			description: messages.error.openImage(sourcePath, error.message),
		});
		osDialog.showError(imageError);
		analytics.logException(error);
	}

	private async selectDriveAsImage(drive: scanner.adapters.DrivelistDrive) {
		const source = new sourceDestination.BlockDevice({ drive });
		const devicePath = source.devicePath || source.device;
		try {
			const metadata = await this.getMetadata(source, devicePath);
			this.selectImage(metadata);
			this.props.afterSelected({
				imagePath: devicePath,
				SourceType: sourceDestination.BlockDevice,
			});
		} catch (error) {
			this.handleError('Error opening drive', devicePath, error);
		} finally {
			try {
				await source.close();
			} catch (error) {
				// Noop
			}
		}
	}

	private async getMetadata(
		source: sourceDestination.SourceDestination | sourceDestination.BlockDevice,
		sourcePath: string,
	) {
		const metadata = (await source.getMetadata()) as SourceMetadata;
		const partitionTable = await source.getPartitionTable();
		if (partitionTable) {
			metadata.hasMBR = true;
			metadata.partitions = partitionTable.partitions;
		} else {
			metadata.hasMBR = false;
		}
		metadata.path = sourcePath;
		return metadata;
	}

	private async openImageSelector() {
		analytics.logEvent('Open image selector');

		try {
			const imagePath = await osDialog.selectImage();
			// Avoid analytics and selection state changes
			// if no file was resolved from the dialog.
			if (!imagePath) {
				analytics.logEvent('Image selector closed');
				return;
			}
			this.selectImageByPath({
				imagePath,
				SourceType: sourceDestination.File,
			});
		} catch (error) {
			exceptionReporter.report(error);
		}
	}

	private onDrop(event: React.DragEvent<HTMLDivElement>) {
		const [file] = event.dataTransfer.files;
		if (file) {
			this.selectImageByPath({
				imagePath: file.path,
				SourceType: sourceDestination.File,
			});
		}
	}

	private openURLSelector() {
		analytics.logEvent('Open image URL selector');

		this.setState({
			showURLSelector: true,
		});
	}

	private openDriveSelector() {
		analytics.logEvent('Open drive selector');

		this.setState({
			showDriveSelector: true,
		});
	}

	private onDragOver(event: React.DragEvent<HTMLDivElement>) {
		// Needed to get onDrop events on div elements
		event.preventDefault();
	}

	private onDragEnter(event: React.DragEvent<HTMLDivElement>) {
		// Needed to get onDrop events on div elements
		event.preventDefault();
	}

	private showSelectedImageDetails() {
		analytics.logEvent('Show selected image tooltip', {
			imagePath: selectionState.getImagePath(),
		});

		this.setState({
			showImageDetails: true,
		});
	}

	// TODO add a visual change when dragging a file over the selector
	public render() {
		const { flashing } = this.props;
		const { showImageDetails, showURLSelector, showDriveSelector } = this.state;

		const hasImage = selectionState.hasImage();

		const imagePath = selectionState.getImagePath();
		const imageBasename = hasImage ? path.basename(imagePath) : '';
		const imageName = selectionState.getImageName();
		const imageSize = selectionState.getImageSize();
		const imageLogo = selectionState.getImageLogo();

		return (
			<>
				<Flex
					flexDirection="column"
					alignItems="center"
					onDrop={(evt: React.DragEvent<HTMLDivElement>) => this.onDrop(evt)}
					onDragEnter={(evt: React.DragEvent<HTMLDivElement>) =>
						this.onDragEnter(evt)
					}
					onDragOver={(evt: React.DragEvent<HTMLDivElement>) =>
						this.onDragOver(evt)
					}
				>
					<SVGIcon
						contents={imageLogo}
						fallback={ImageSvg}
						style={{
							marginBottom: 30,
						}}
					/>

					{hasImage ? (
						<>
							<StepNameButton
								plain
								onClick={() => this.showSelectedImageDetails()}
								tooltip={imageName || imageBasename}
							>
								{middleEllipsis(imageName || imageBasename, 20)}
							</StepNameButton>
							{!flashing && (
								<ChangeButton
									plain
									mb={14}
									onClick={() => this.reselectImage()}
								>
									Remove
								</ChangeButton>
							)}
							<DetailsText>{shared.bytesToClosestUnit(imageSize)}</DetailsText>
						</>
					) : (
						<>
							<FlowSelector
								key="Flash from file"
								flow={{
									onClick: () => this.openImageSelector(),
									label: 'Flash from file',
									icon: <FontAwesomeIcon icon={faFile} />,
								}}
							/>
							<FlowSelector
								key="Flash from URL"
								flow={{
									onClick: () => this.openURLSelector(),
									label: 'Flash from URL',
									icon: <FontAwesomeIcon icon={faLink} />,
								}}
							/>
							<FlowSelector
								key="Clone drive"
								flow={{
									onClick: () => this.openDriveSelector(),
									label: 'Clone drive',
									icon: <FontAwesomeIcon icon={faCopy} />,
								}}
							/>
						</>
					)}
				</Flex>

				{this.state.warning != null && (
					<SmallModal
						titleElement={
							<span>
								<FontAwesomeIcon
									style={{ color: '#fca321' }}
									icon={faExclamationTriangle}
								/>{' '}
								<span>{this.state.warning.title}</span>
							</span>
						}
						action="Continue"
						cancel={() => {
							this.setState({ warning: null });
							this.reselectImage();
						}}
						done={() => {
							this.setState({ warning: null });
						}}
						primaryButtonProps={{ warning: true, primary: false }}
					>
						<ModalText
							dangerouslySetInnerHTML={{ __html: this.state.warning.message }}
						/>
					</SmallModal>
				)}

				{showImageDetails && (
					<SmallModal
						title="Image"
						done={() => {
							this.setState({ showImageDetails: false });
						}}
					>
						<Txt.p>
							<Txt.span bold>Name: </Txt.span>
							<Txt.span>{imageName || imageBasename}</Txt.span>
						</Txt.p>
						<Txt.p>
							<Txt.span bold>Path: </Txt.span>
							<Txt.span>{imagePath}</Txt.span>
						</Txt.p>
					</SmallModal>
				)}

				{showURLSelector && (
					<URLSelector
						cancel={() => {
							this.setState({
								showURLSelector: false,
							});
						}}
						done={async (imageURL: string) => {
							// Avoid analytics and selection state changes
							// if no file was resolved from the dialog.
							if (!imageURL) {
								analytics.logEvent('URL selector closed');
								this.setState({
									showURLSelector: false,
								});
								return;
							}

							await this.selectImageByPath({
								imagePath: imageURL,
								SourceType: sourceDestination.Http,
							});
							this.setState({
								showURLSelector: false,
							});
						}}
					/>
				)}

				{showDriveSelector && (
					<DriveSelector
						multipleSelection={false}
						titleLabel="Select source"
						emptyListLabel="Plug a source"
						cancel={() => {
							this.setState({
								showDriveSelector: false,
							});
						}}
						done={async (drives: scanner.adapters.DrivelistDrive[]) => {
							if (!drives.length) {
								analytics.logEvent('Drive selector closed');
								this.setState({
									showDriveSelector: false,
								});
								return;
							}

							await this.selectDriveAsImage(drives[0]);
							this.setState({
								showDriveSelector: false,
							});
						}}
					/>
				)}
			</>
		);
	}
}
