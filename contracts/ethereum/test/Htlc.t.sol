// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Test, console} from "../lib/forge-std/src/Test.sol";
import {Htlc} from "../src/Htlc.sol";

contract test_Htlc is Test {
    Htlc public htlc;

    bytes32 public secret = 0xd115e2ed2c224310de4a468136c0a85bc10b5c9b2c52d8cd8124fe6ebc447b0f;
//  secret = mydog
    bytes32 swapId;
    address payable claimer;

    function setUp() public {
        htlc = new Htlc();
        claimer = payable(address(0x123));
        swapId = htlc.initiateSwap{value: 5 ether}(secret);
    }

    function testWithdrawDeniedTest() public {
        vm.expectRevert("Wrong secret");
        htlc.withdrawFunds("bigdogo", swapId);
    }

    function testTimeWithdrawDenied() public {
        vm.expectRevert('Please wait at least 1 hour since the initiation of the swap');
        htlc.timeWithdraw(swapId);
    }

    function testWithdrawSucess() public {
        htlc.withdrawFunds("mydog", swapId);
    }


}
