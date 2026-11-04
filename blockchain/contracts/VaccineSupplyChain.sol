// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract VaccineSupplyChain {
    address public immutable owner;
    address public immutable productionSigner;
    address public immutable labSigner;
    mapping(address => bool) public writers;
    mapping(bytes32 => bytes32) public auditDigests;
    event WriterUpdated(address indexed writer, bool enabled);
    event AuditAnchored(bytes32 indexed eventId, bytes32 digest, address indexed writer);
    struct SensorRoot {
        bytes32 root;
        string batchId;
        uint256 windowStart;
        uint256 windowEnd;
        uint256 count;
    }
    mapping(bytes32 => SensorRoot) private sensorRoots;
    event SensorRootAnchored(bytes32 indexed windowId, string batchId, bytes32 root,
        uint256 windowStart, uint256 windowEnd, uint256 count);
    struct TransportIdentity { string shipmentId; string vehicleId; string routeId; }
    mapping(string => mapping(uint256 => TransportIdentity)) private lifecycleTransport;
    event LifecycleTransportLogged(string batchId, uint256 lifecycleIndex,
        string shipmentId, string vehicleId, string routeId);

    // Companion deployments can commit evidence for batches registered on the
    // original contract. Verification must separately establish batch identity.
    function anchorSensorRoot(bytes32 windowId, string calldata batchId, bytes32 root,
        uint256 windowStart, uint256 windowEnd, uint256 count) external onlyWriter {
        require(windowId != bytes32(0) && root != bytes32(0), "Empty root");
        require(bytes(batchId).length > 0 && windowEnd > windowStart && count > 0 && count <= 100, "Invalid window");
        SensorRoot storage existing = sensorRoots[windowId];
        if (existing.count > 0) {
            require(existing.root == root && keccak256(bytes(existing.batchId)) == keccak256(bytes(batchId))
                && existing.windowStart == windowStart && existing.windowEnd == windowEnd
                && existing.count == count, "Root conflict");
            return;
        }
        sensorRoots[windowId] = SensorRoot(root, batchId, windowStart, windowEnd, count);
        emit SensorRootAnchored(windowId, batchId, root, windowStart, windowEnd, count);
    }
    function getSensorRoot(bytes32 windowId) external view returns (SensorRoot memory) {
        return sensorRoots[windowId];
    }
    function logTransportLifecycle(LifecycleEvent calldata entry, TransportIdentity calldata transport) external onlyWriter {
        uint256 index = batchLifecycle[entry.batchId].length;
        _logLifecycleEvent(entry.batchId, entry.actorRole, entry.action, entry.location, entry.details, entry.quantity);
        lifecycleTransport[entry.batchId][index] = transport;
        emit LifecycleTransportLogged(entry.batchId, index, transport.shipmentId, transport.vehicleId, transport.routeId);
    }
    function getLifecycleTransport(string calldata batchId, uint256 index)
        external view returns (TransportIdentity memory) { return lifecycleTransport[batchId][index]; }

    constructor(address production, address lab) {
        require(production != address(0) && lab != address(0) && production != lab, "Distinct release signers required");
        owner = msg.sender;
        productionSigner = production;
        labSigner = lab;
        writers[msg.sender] = true;
    }
    modifier onlyWriter() { require(writers[msg.sender], "Writer required"); _; }
    function setWriter(address writer, bool enabled) external {
        require(msg.sender == owner, "Owner required");
        require(writer != address(0), "Zero writer");
        writers[writer] = enabled;
        emit WriterUpdated(writer, enabled);
    }
    function anchorAudit(bytes32 eventId, bytes32 digest) external onlyWriter {
        require(eventId != bytes32(0) && digest != bytes32(0), "Empty anchor");
        bytes32 existing = auditDigests[eventId];
        require(existing == bytes32(0) || existing == digest, "Audit digest conflict");
        if (existing == bytes32(0)) {
            auditDigests[eventId] = digest;
            emit AuditAnchored(eventId, digest, msg.sender);
        }
    }
    struct Distribution {
        string targetCenter;
        uint256 recommendedUnits;
        string priorityScore;
        uint256 timestamp;
    }

    struct Batch {
        string batchId;
        string vaccineType;
        uint256 quantity;
        address manufacturer;
        string status;
        bool productionApproved;
        bool labApproved;
        bool releaseVisible;
        uint256 baselineDemandForecast;
    }

    struct InventoryCertificate {
        string batchId;
        string vaccineType;
        uint256 predictedDemand;
        string certificateUri;
        uint256 issuedAt;
        address issuer;
    }

    struct LifecycleEvent {
        string batchId;
        string actorRole;
        string action;
        string location;
        string details;
        uint256 quantity;
        uint256 timestamp;
        address actor;
    }

    // Integer-scaled sensor values avoid floating-point ambiguity on chain:
    // temperature/humidity/battery use 0.001 units; GPS uses 0.000001 degrees.
    struct TemperatureReading {
        bytes32 recordId;
        bytes32 digest;
        string batchId;
        string deviceId;
        string vehicleId;
        string shipmentId;
        uint256 recordedAtMilliseconds;
        int256 temperatureMilliC;
        uint256 humidityMilliPercent;
        uint256 batteryMilliPercent;
        int256 latitudeMicrodegrees;
        int256 longitudeMicrodegrees;
        bool hasHumidity;
        bool hasBattery;
        bool hasLocation;
    }

    struct TemperatureReadingCommitment {
        string batchId;
        bytes32 recordId;
        string deviceId;
        string vehicleId;
        string shipmentId;
        uint256 recordedAtMilliseconds;
        int256 temperatureMilliC;
        uint256 humidityMilliPercent;
        uint256 batteryMilliPercent;
        int256 latitudeMicrodegrees;
        int256 longitudeMicrodegrees;
        bool hasHumidity;
        bool hasBattery;
        bool hasLocation;
    }

    Distribution[] public distributions;
    mapping(string => Batch) public batches;
    mapping(string => InventoryCertificate) private inventoryCertificates;
    mapping(string => LifecycleEvent[]) private batchLifecycle;
    mapping(string => string[]) private batchStatusHistory;
    mapping(string => TemperatureReading[]) private batchTemperatureHistory;
    mapping(bytes32 => string) private telemetryBatchById;
    mapping(bytes32 => uint256) private telemetryIndexPlusOne;
    mapping(bytes32 => bytes32) private telemetryDigestById;

    event DistributionRecorded(
        string indexed targetCenter,
        uint256 recommendedUnits,
        string priorityScore,
        uint256 timestamp,
        address indexed actor
    );

    event BatchRegistered(
        string indexed batchId,
        string vaccineType,
        uint256 quantity,
        address indexed manufacturer,
        uint256 timestamp
    );

    event LifecycleLogged(
        string indexed batchId,
        string actorRole,
        string action,
        string location,
        string details,
        uint256 quantity,
        uint256 timestamp,
        address indexed actor
    );

    event BatchStatusUpdated(
        string indexed batchId,
        string status,
        uint256 timestamp,
        address indexed actor
    );

    event InventoryCertificateMinted(
        string indexed batchId,
        string vaccineType,
        uint256 predictedDemand,
        string certificateUri,
        uint256 timestamp,
        address indexed actor
    );

    event BatchReleaseRoleSigned(
        string indexed batchId,
        string role,
        uint256 timestamp,
        address indexed actor
    );

    event BatchReleasedToSupplyChain(
        string indexed batchId,
        uint256 timestamp,
        address indexed actor
    );

    event TemperatureReadingAppended(
        bytes32 indexed recordId,
        string indexed batchId,
        bytes32 digest,
        uint256 recordedAtMilliseconds
    );

    function recordDistribution(
        string memory _targetCenter,
        uint256 _recommendedUnits,
        string memory _priorityScore
    ) public onlyWriter {
        distributions.push(
            Distribution({
                targetCenter: _targetCenter,
                recommendedUnits: _recommendedUnits,
                priorityScore: _priorityScore,
                timestamp: block.timestamp
            })
        );

        emit DistributionRecorded(
            _targetCenter,
            _recommendedUnits,
            _priorityScore,
            block.timestamp,
            msg.sender
        );
    }

    function recordDistributionWithBatch(
        string memory _batchId,
        string memory _targetCenter,
        uint256 _recommendedUnits,
        string memory _priorityScore,
        string memory _details
    ) public onlyWriter {
        recordDistribution(_targetCenter, _recommendedUnits, _priorityScore);
        _logLifecycleEvent(
            _batchId,
            "Distributor",
            "Distribution Recorded",
            _targetCenter,
            _details,
            _recommendedUnits
        );
    }

    function registerBatch(
        string memory _batchId,
        string memory _vaccineType,
        uint _quantity
    ) public onlyWriter {
        require(bytes(_batchId).length > 0, "Batch ID required");
        require(bytes(batches[_batchId].batchId).length == 0, "Batch already registered");
        batches[_batchId] = Batch(
            _batchId,
            _vaccineType,
            _quantity,
            msg.sender,
            "Awaiting Multi-Sign Release",
            false,
            false,
            false,
            0
        );
        _appendBatchStatus(_batchId, "Awaiting Multi-Sign Release");

        emit BatchRegistered(
            _batchId,
            _vaccineType,
            _quantity,
            msg.sender,
            block.timestamp
        );

        _logLifecycleEvent(
            _batchId,
            "Manufacturer",
            "Batch Registered",
            "Manufacturer Warehouse",
            _vaccineType,
            _quantity
        );
    }

    function mintInventoryCertificate(
        string memory _batchId,
        string memory _vaccineType,
        uint256 _predictedDemand,
        string memory _certificateUri
    ) public onlyWriter {
        require(bytes(_batchId).length > 0, "Batch ID required");
        require(bytes(batches[_batchId].batchId).length > 0, "Batch not found");
        require(inventoryCertificates[_batchId].issuedAt == 0, "Certificate already issued");

        inventoryCertificates[_batchId] = InventoryCertificate({
            batchId: _batchId,
            vaccineType: _vaccineType,
            predictedDemand: _predictedDemand,
            certificateUri: _certificateUri,
            issuedAt: block.timestamp,
            issuer: msg.sender
        });

        if (bytes(batches[_batchId].batchId).length > 0) {
            batches[_batchId].baselineDemandForecast = _predictedDemand;
        }

        emit InventoryCertificateMinted(
            _batchId,
            _vaccineType,
            _predictedDemand,
            _certificateUri,
            block.timestamp,
            msg.sender
        );

        _logLifecycleEvent(
            _batchId,
            "Manufacturer",
            "Mint Inventory Certificate",
            "Manufacturer Planning",
            _certificateUri,
            _predictedDemand
        );
    }

    function approveBatchRelease(
        string memory _batchId,
        string memory _role
    ) public {
        require(bytes(_batchId).length > 0, "Batch ID required");
        require(bytes(batches[_batchId].batchId).length > 0, "Batch not found");

        bytes32 roleHash = keccak256(bytes(_role));

        if (roleHash == keccak256(bytes("Production"))) {
            require(msg.sender == productionSigner, "Production signer required");
            require(!batches[_batchId].productionApproved, "Production sign-off already recorded");
            batches[_batchId].productionApproved = true;
        } else if (roleHash == keccak256(bytes("Lab Testing"))) {
            require(msg.sender == labSigner, "Lab signer required");
            require(!batches[_batchId].labApproved, "Lab sign-off already recorded");
            batches[_batchId].labApproved = true;
        } else {
            revert("Invalid release role");
        }

        emit BatchReleaseRoleSigned(_batchId, _role, block.timestamp, msg.sender);

        _logLifecycleEvent(
            _batchId,
            "Manufacturer",
            "Release Sign-Off",
            "Quality Gate",
            _role,
            batches[_batchId].quantity
        );

        if (
            batches[_batchId].productionApproved &&
            batches[_batchId].labApproved
        ) {
            batches[_batchId].releaseVisible = true;
            _appendBatchStatus(_batchId, "Released to Supply Chain");

            emit BatchReleasedToSupplyChain(_batchId, block.timestamp, msg.sender);

            _logLifecycleEvent(
                _batchId,
                "Manufacturer",
                "Release Batch To Supply Chain",
                "Manufacturer Warehouse",
                "Production and Lab Testing approvals completed",
                batches[_batchId].quantity
            );
        }
    }

    function updateBatchStatus(
        string memory _batchId,
        string memory _status
    ) public onlyWriter {
        require(bytes(_batchId).length > 0, "Batch ID required");
        require(bytes(batches[_batchId].batchId).length > 0, "Batch not found");
        require(bytes(_status).length > 0, "Status required");
        _appendBatchStatus(_batchId, _status);
    }

    function getBatchStatusCount(string memory _batchId) public view returns (uint256) {
        return batchStatusHistory[_batchId].length;
    }

    function getBatchStatusAt(string memory _batchId, uint256 _index) public view returns (string memory) {
        return batchStatusHistory[_batchId][_index];
    }

    function recordTemperatureReading(TemperatureReading calldata reading) external onlyWriter {
        require(bytes(reading.batchId).length > 0 && bytes(batches[reading.batchId].batchId).length > 0, "Batch not found");
        require(reading.recordId != bytes32(0) && reading.digest != bytes32(0), "Empty telemetry evidence");
        require(reading.recordedAtMilliseconds > 0, "Reading timestamp required");
        require(reading.temperatureMilliC >= -100000 && reading.temperatureMilliC <= 100000, "Temperature out of range");
        if (reading.hasHumidity) require(reading.humidityMilliPercent <= 100000, "Humidity out of range");
        if (reading.hasBattery) require(reading.batteryMilliPercent <= 100000, "Battery out of range");
        if (reading.hasLocation) {
            require(reading.latitudeMicrodegrees >= -90000000 && reading.latitudeMicrodegrees <= 90000000, "Latitude out of range");
            require(reading.longitudeMicrodegrees >= -180000000 && reading.longitudeMicrodegrees <= 180000000, "Longitude out of range");
        }

        TemperatureReadingCommitment memory commitment;
        commitment.batchId = reading.batchId;
        commitment.recordId = reading.recordId;
        commitment.deviceId = reading.deviceId;
        commitment.vehicleId = reading.vehicleId;
        commitment.shipmentId = reading.shipmentId;
        commitment.recordedAtMilliseconds = reading.recordedAtMilliseconds;
        commitment.temperatureMilliC = reading.temperatureMilliC;
        commitment.humidityMilliPercent = reading.humidityMilliPercent;
        commitment.batteryMilliPercent = reading.batteryMilliPercent;
        commitment.latitudeMicrodegrees = reading.latitudeMicrodegrees;
        commitment.longitudeMicrodegrees = reading.longitudeMicrodegrees;
        commitment.hasHumidity = reading.hasHumidity;
        commitment.hasBattery = reading.hasBattery;
        commitment.hasLocation = reading.hasLocation;
        require(sha256(abi.encode(commitment)) == reading.digest, "Telemetry digest does not match fields");

        uint256 existingIndex = telemetryIndexPlusOne[reading.recordId];
        if (existingIndex != 0) {
            require(telemetryDigestById[reading.recordId] == reading.digest, "Telemetry record conflict");
            require(keccak256(bytes(telemetryBatchById[reading.recordId])) == keccak256(bytes(reading.batchId)), "Telemetry batch conflict");
            return;
        }

        batchTemperatureHistory[reading.batchId].push(reading);
        telemetryBatchById[reading.recordId] = reading.batchId;
        telemetryIndexPlusOne[reading.recordId] = batchTemperatureHistory[reading.batchId].length;
        telemetryDigestById[reading.recordId] = reading.digest;
        emit TemperatureReadingAppended(reading.recordId, reading.batchId, reading.digest, reading.recordedAtMilliseconds);
    }

    function getTemperatureReadingCount(string memory _batchId) public view returns (uint256) {
        return batchTemperatureHistory[_batchId].length;
    }

    function getTemperatureReading(string memory _batchId, uint256 _index)
        public view returns (TemperatureReading memory)
    {
        return batchTemperatureHistory[_batchId][_index];
    }

    function getTemperatureReadingById(bytes32 _recordId)
        public view returns (TemperatureReading memory)
    {
        uint256 index = telemetryIndexPlusOne[_recordId];
        require(index != 0, "Telemetry record not found");
        return batchTemperatureHistory[telemetryBatchById[_recordId]][index - 1];
    }

    function logLifecycleEvent(
        string memory _batchId,
        string memory _actorRole,
        string memory _action,
        string memory _location,
        string memory _details,
        uint256 _quantity
    ) public onlyWriter {
        _logLifecycleEvent(
            _batchId,
            _actorRole,
            _action,
            _location,
            _details,
            _quantity
        );
    }

    function getLifecycleCount(
        string memory _batchId
    ) public view returns (uint256) {
        return batchLifecycle[_batchId].length;
    }

    function getLifecycleEvent(
        string memory _batchId,
        uint256 _index
    )
        public
        view
        returns (
            string memory,
            string memory,
            string memory,
            string memory,
            string memory,
            uint256,
            uint256,
            address
        )
    {
        LifecycleEvent memory lifecycle = batchLifecycle[_batchId][_index];

        return (
            lifecycle.batchId,
            lifecycle.actorRole,
            lifecycle.action,
            lifecycle.location,
            lifecycle.details,
            lifecycle.quantity,
            lifecycle.timestamp,
            lifecycle.actor
        );
    }

    function getBatch(string memory _batchId)
        public
        view
        returns (
            string memory,
            string memory,
            uint,
            address,
            string memory
        )
    {
        Batch memory b = batches[_batchId];
        uint256 statusCount = batchStatusHistory[_batchId].length;
        string memory currentStatus = statusCount == 0 ? "" : batchStatusHistory[_batchId][statusCount - 1];

        return (
            b.batchId,
            b.vaccineType,
            b.quantity,
            b.manufacturer,
            currentStatus
        );
    }

    function getInventoryCertificate(
        string memory _batchId
    )
        public
        view
        returns (
            string memory,
            string memory,
            uint256,
            string memory,
            uint256,
            address
        )
    {
        InventoryCertificate memory cert = inventoryCertificates[_batchId];
        return (
            cert.batchId,
            cert.vaccineType,
            cert.predictedDemand,
            cert.certificateUri,
            cert.issuedAt,
            cert.issuer
        );
    }

    function getReleaseState(
        string memory _batchId
    )
        public
        view
        returns (
            bool,
            bool,
            bool,
            string memory
        )
    {
        Batch memory batch = batches[_batchId];
        uint256 statusCount = batchStatusHistory[_batchId].length;
        string memory currentStatus = statusCount == 0 ? "" : batchStatusHistory[_batchId][statusCount - 1];
        return (
            batch.productionApproved,
            batch.labApproved,
            batch.releaseVisible,
            currentStatus
        );
    }

    function _appendBatchStatus(string memory _batchId, string memory _status) internal {
        string[] storage history = batchStatusHistory[_batchId];
        if (history.length > 0 && keccak256(bytes(history[history.length - 1])) == keccak256(bytes(_status))) return;
        history.push(_status);
        emit BatchStatusUpdated(_batchId, _status, block.timestamp, msg.sender);
    }

    function _logLifecycleEvent(
        string memory _batchId,
        string memory _actorRole,
        string memory _action,
        string memory _location,
        string memory _details,
        uint256 _quantity
    ) internal {
        LifecycleEvent memory lifecycle = LifecycleEvent({
            batchId: _batchId,
            actorRole: _actorRole,
            action: _action,
            location: _location,
            details: _details,
            quantity: _quantity,
            timestamp: block.timestamp,
            actor: msg.sender
        });

        batchLifecycle[_batchId].push(lifecycle);

        emit LifecycleLogged(
            _batchId,
            _actorRole,
            _action,
            _location,
            _details,
            _quantity,
            block.timestamp,
            msg.sender
        );
    }
}
