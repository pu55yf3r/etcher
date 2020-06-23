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

import { scanner } from 'etcher-sdk';
import * as React from 'react';
import { Flex } from 'rendition';
import { TargetSelectorButton } from './target-selector-button';
import {
	DriveSelector,
	DriveSelectorProps,
} from '../drive-selector/drive-selector';
import {
	isDriveSelected,
	getImage,
	getSelectedDrives,
	deselectDrive,
	selectDrive,
} from '../../models/selection-state';
import * as settings from '../../models/settings';
import { observe } from '../../models/store';
import * as analytics from '../../modules/analytics';
import DriveSvg from '../../../assets/drive.svg';

export const getDriveListLabel = () => {
	return getSelectedDrives()
		.map((drive: any) => {
			return `${drive.description} (${drive.displayName})`;
		})
		.join('\n');
};

const shouldShowDrivesButton = () => {
	return !settings.getSync('disableExplicitDriveSelection');
};

const getDriveSelectionStateSlice = () => ({
	showDrivesButton: shouldShowDrivesButton(),
	driveListLabel: getDriveListLabel(),
	targets: getSelectedDrives(),
	image: getImage(),
});

export const TargetSelectorModal = (
	props: Omit<DriveSelectorProps, 'titleLabel' | 'emptyListLabel'>,
) => (
	<DriveSelector
		titleLabel="Select target"
		emptyListLabel="Plug a target drive"
		{...props}
	/>
);

export const selectAllTargets = (
	modalTargets: scanner.adapters.DrivelistDrive[],
) => {
	const selectedDrivesFromState = getSelectedDrives();
	const deselected = selectedDrivesFromState.filter(
		(drive) =>
			!modalTargets.find((modalTarget) => modalTarget.device === drive.device),
	);
	// deselect drives
	deselected.forEach((drive) => {
		analytics.logEvent('Toggle drive', {
			drive,
			previouslySelected: true,
		});
		deselectDrive(drive.device);
	});
	// select drives
	modalTargets.forEach((drive) => {
		// Don't send events for drives that were already selected
		if (!isDriveSelected(drive.device)) {
			analytics.logEvent('Toggle drive', {
				drive,
				previouslySelected: false,
			});
		}
		selectDrive(drive.device);
	});
};

interface TargetSelectorProps {
	disabled: boolean;
	hasDrive: boolean;
	flashing: boolean;
}

export const TargetSelector = ({
	disabled,
	hasDrive,
	flashing,
}: TargetSelectorProps) => {
	// TODO: inject these from redux-connector
	const [
		{ showDrivesButton, driveListLabel, targets, image },
		setStateSlice,
	] = React.useState(getDriveSelectionStateSlice());
	const [showTargetSelectorModal, setShowTargetSelectorModal] = React.useState(
		false,
	);

	React.useEffect(() => {
		return observe(() => {
			setStateSlice(getDriveSelectionStateSlice());
		});
	}, []);

	return (
		<Flex flexDirection="column" alignItems="center">
			<DriveSvg
				className={disabled ? 'disabled' : ''}
				width="40px"
				style={{
					marginBottom: 30,
				}}
			/>

			<TargetSelectorButton
				disabled={disabled}
				show={!hasDrive && showDrivesButton}
				tooltip={driveListLabel}
				openDriveSelector={() => {
					setShowTargetSelectorModal(true);
				}}
				reselectDrive={() => {
					analytics.logEvent('Reselect drive');
					setShowTargetSelectorModal(true);
				}}
				flashing={flashing}
				targets={targets}
				image={image}
			/>

			{showTargetSelectorModal && (
				<TargetSelectorModal
					cancel={() => setShowTargetSelectorModal(false)}
					done={(modalTargets) => {
						selectAllTargets(modalTargets);
						setShowTargetSelectorModal(false);
					}}
				/>
			)}
		</Flex>
	);
};
