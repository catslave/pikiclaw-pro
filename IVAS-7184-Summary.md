# IVAS-7184: Cross-Region Failover for NCA gRPC generateCode

## Goal
Implement cross-region failover for NCA gRPC `generateCode` when a 503 error is encountered, ensuring the system remains robust even after a gRPC connection is established.

## Current Understanding & Requirements
* **Goal**: Handle NCA `generateCode` 503 errors by failing over to another Region.
* **Scope**: 
    * Catch 503 errors (NCA/Agent downstream GMG unavailability).
    * Mask intermediate 503s from upstream TEL.
    * Propagate errors to TEL only when all candidate Regions are exhausted.
* **Constraints/Instructions Clarified**:
    1.  **Repo**: Development must occur in `/Users/michael.yang/Codes/RC/AIR/assistant-runtime-next-gen`.
    2.  **Testing**: Unit tests are required for this stage; self-testing can be deferred.
    3.  **Error Handling**: Only 503 triggers failover. Need to confirm how NCA signifies this (gRPC Status vs. app-level error code).
    4.  **Failover Logic**: Reuse existing error-handling patterns. If currently in a fallback Region, do not attempt further failover; propagate the error.
    5.  **Logging**: Logs must explicitly show 503 occurrence, failover initiation, and final success/failure.

## Pending Actions
1.  **Locate Code**: Identify the specific service/controller class handling the NCA gRPC call and the region selection/failover logic.
2.  **Determine Error Detection**: Identify the specific field in the response (gRPC metadata or response payload) that carries the 503 error code.
3.  **Implement**: Refactor the `generateCode` call site to handle the exception, check error eligibility, trigger region selection, and retry once.
4.  **Verify**: Write unit tests covering 503 error capture and regional failover.
